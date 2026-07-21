package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const maxWebhookBodyBytes = 1 << 20

var (
	redisClient *redis.Client
	appSecret   string
	verifyToken string
	redisQueue  = "whatsapp-webhooks"
)

func main() {
	// Initialize logging
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// Load Environment variables
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	appSecret = os.Getenv("META_APP_SECRET")
	verifyToken = os.Getenv("WHATSAPP_VERIFY_TOKEN")
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	log.Printf("Starting Go Ingress webhook receiver...")
	log.Printf("Redis URL: %s", redisURL)

	// Initialize Redis
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}
	redisClient = redis.NewClient(opt)

	// Verify Redis connection on startup
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Printf("[Warning] Failed to ping Redis on startup: %v. Will retry on request.", err)
	} else {
		log.Println("Successfully connected to Redis.")
	}

	// Handlers
	http.HandleFunc("/api/whatsapp/webhook", handleWebhook)
	http.HandleFunc("/healthz", handleHealthz)

	log.Printf("Server listening on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func handleWebhook(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handleVerification(w, r)
	case http.MethodPost:
		handleEvent(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleVerification(w http.ResponseWriter, r *http.Request) {
	verifyTokenParam := r.URL.Query().Get("hub.verify_token")
	challenge := r.URL.Query().Get("hub.challenge")
	mode := r.URL.Query().Get("hub.mode")

	if mode != "subscribe" || challenge == "" || verifyTokenParam == "" {
		http.Error(w, "Missing verification parameters", http.StatusBadRequest)
		return
	}

	// 1. Match against static environment token first
	if verifyToken != "" && verifyTokenParam == verifyToken {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(challenge))
		log.Printf("[GET] Successfully verified challenge using static token.")
		return
	}

	// 2. Fallback: Proxy request to Next.js server to run database/decryption verify checks
	nextjsURL := os.Getenv("NEXTJS_BACKEND_URL")
	if nextjsURL == "" {
		nextjsURL = os.Getenv("NEXT_PUBLIC_SITE_URL")
	}
	if nextjsURL == "" {
		nextjsURL = "http://localhost:3000"
	}

	proxyURL := fmt.Sprintf("%s/api/whatsapp/webhook?%s", strings.TrimSuffix(nextjsURL, "/"), r.URL.RawQuery)
	log.Printf("[GET] Static verification mismatch. Proxying request to: %s", proxyURL)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(proxyURL)
	if err != nil {
		log.Printf("[GET] Proxy request failed: %v", err)
		http.Error(w, "Proxy verification failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[GET] Failed to read proxy response: %v", err)
		http.Error(w, "Failed to read response", http.StatusInternalServerError)
		return
	}

	for k, v := range resp.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

func handleEvent(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// 1. Reject when the secret is unset — fail closed, never skip
	//    signature validation (mirrors webhook-signature.ts contract).
	if appSecret == "" {
		log.Println("[POST] META_APP_SECRET is not set; rejecting request")
		http.Error(w, "Server misconfigured", http.StatusServiceUnavailable)
		return
	}

	// 2. Read request body (capped to guard against oversized payloads)
	r.Body = http.MaxBytesReader(w, r.Body, maxWebhookBodyBytes)
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("[POST] Failed to read body: %v", err)
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// 3. Validate HMAC signature
	signature := r.Header.Get("X-Hub-Signature-256")
	if signature == "" {
		log.Println("[POST] Missing X-Hub-Signature-256 header")
		http.Error(w, "Missing signature", http.StatusUnauthorized)
		return
	}

	if !verifySignature(bodyBytes, signature, appSecret) {
		log.Printf("[POST] Invalid HMAC signature. Header: %s", signature)
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// 4. Enqueue to Redis
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	err = redisClient.RPush(ctx, redisQueue, string(bodyBytes)).Err()
	if err != nil {
		log.Printf("[POST] Redis enqueue error: %v", err)
		http.Error(w, "Queue failed", http.StatusInternalServerError)
		return
	}

	// 5. Return HTTP 200 instantly
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "queued"})

	log.Printf("[POST] Enqueued message successfully in %v", time.Since(startTime))
}

func verifySignature(body []byte, signatureHeader string, secret string) bool {
	if !strings.HasPrefix(signatureHeader, "sha256=") {
		return false
	}
	hexSignature := signatureHeader[7:]
	expectedSignature, err := hex.DecodeString(hexSignature)
	if err != nil {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	computedSignature := mac.Sum(nil)

	// Secure constant-time comparison
	return hmac.Equal(computedSignature, expectedSignature)
}
