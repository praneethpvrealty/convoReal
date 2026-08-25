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
	"regexp"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
	"github.com/redis/go-redis/v9"
)

const maxWebhookBodyBytes = 1 << 20

var (
	redisClient   *redis.Client
	appSecret     string
	verifyToken   string
	redisQueue    = "whatsapp-webhooks"
	phonePattern  = regexp.MustCompile(`(?:\+?\d[\s().-]*){8,}`)
	emailPattern  = regexp.MustCompile(`(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`)
	bearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[^\s,;]+`)
)

func main() {
	// Initialize logging
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	initSentry()
	defer sentry.Flush(2 * time.Second)

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
	log.Printf("Redis connection configured")

	// Initialize Redis
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		captureOperationalError(context.Background(), err, "parse_redis_url")
		sentry.Flush(2 * time.Second)
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}
	redisClient = redis.NewClient(opt)

	// Verify Redis connection on startup
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		captureOperationalError(ctx, err, "startup_redis_ping")
		log.Printf("[Warning] Failed to ping Redis on startup: %v. Will retry on request.", err)
	} else {
		log.Println("Successfully connected to Redis.")
	}

	// Handlers
	mux := http.NewServeMux()
	mux.HandleFunc("/api/whatsapp/webhook", handleWebhook)
	mux.HandleFunc("/healthz", handleHealthz)
	sentryHandler := sentryhttp.New(sentryhttp.Options{Repanic: true})
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           sentryHandler.Handle(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("Server listening on port %s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		captureOperationalError(context.Background(), err, "http_server")
		sentry.Flush(2 * time.Second)
		log.Fatalf("Server failed: %v", err)
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if redisClient == nil || redisClient.Ping(ctx).Err() != nil {
		http.Error(w, "degraded", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
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
	log.Printf("[GET] Static verification mismatch. Proxying request to Next.js backend.")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(proxyURL)
	if err != nil {
		captureOperationalError(r.Context(), err, "verification_proxy_request")
		log.Printf("[GET] Proxy request failed: %v", err)
		http.Error(w, "Proxy verification failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		captureOperationalError(r.Context(), err, "verification_proxy_read")
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
		captureOperationalError(r.Context(), err, "redis_enqueue")
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

func initSentry() {
	dsn := os.Getenv("SENTRY_DSN")
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:            dsn,
		EnableTracing:  false,
		Environment:    os.Getenv("SENTRY_ENVIRONMENT"),
		Release:        os.Getenv("SENTRY_RELEASE"),
		SendDefaultPII: false,
		BeforeSend:     sanitizeSentryEvent,
	}); err != nil {
		log.Printf("[Warning] Sentry initialization failed: %v", err)
	}
}

func sanitizeSentryEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	event.User = sentry.User{}
	event.Extra = nil
	event.Breadcrumbs = nil
	if event.Request != nil {
		event.Request.URL = strings.SplitN(strings.SplitN(event.Request.URL, "?", 2)[0], "#", 2)[0]
		event.Request.Data = ""
		event.Request.QueryString = ""
		event.Request.Cookies = ""
		event.Request.Headers = nil
		event.Request.Env = nil
	}
	event.Message = redactSensitiveText(event.Message)
	for index := range event.Exception {
		event.Exception[index].Value = redactSensitiveText(event.Exception[index].Value)
	}
	return event
}

func redactSensitiveText(value string) string {
	value = emailPattern.ReplaceAllString(value, "[email]")
	value = bearerPattern.ReplaceAllString(value, "Bearer [token]")
	return phonePattern.ReplaceAllString(value, "[phone]")
}

func captureOperationalError(ctx context.Context, err error, operation string) {
	if err == nil {
		return
	}
	hub := sentry.GetHubFromContext(ctx)
	if hub == nil {
		hub = sentry.CurrentHub()
	}
	hub.WithScope(func(scope *sentry.Scope) {
		scope.SetTag("runtime", "go-ingress")
		scope.SetTag("operation", operation)
		hub.CaptureException(err)
	})
}
