package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getsentry/sentry-go"
)

func TestVerifySignature(t *testing.T) {
	secret := "secret-key"
	body := []byte(`{"object":"whatsapp_business_account","entry":[]}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	computedSignature := mac.Sum(nil)
	signatureHeader := fmt.Sprintf("sha256=%x", computedSignature)

	if !verifySignature(body, signatureHeader, secret) {
		t.Errorf("Expected signature verification to succeed")
	}

	invalidHeader := "sha256=invalidhash"
	if verifySignature(body, invalidHeader, secret) {
		t.Errorf("Expected signature verification to fail for invalid hash")
	}

	nonShaHeader := "sha1=invalidhash"
	if verifySignature(body, nonShaHeader, secret) {
		t.Errorf("Expected signature verification to fail for non-sha256 prefix")
	}
}

func TestSanitizeSentryEvent(t *testing.T) {
	event := &sentry.Event{
		Message: "Failed for person@example.com at +91 98765 43210",
		User:    sentry.User{Email: "person@example.com", IPAddress: "127.0.0.1"},
		Extra:   map[string]interface{}{"payload": "private"},
		Request: &sentry.Request{
			URL:         "https://www.convoreal.com/webhook?token=private",
			Data:        "private",
			QueryString: "token=private",
			Headers:     map[string]string{"Authorization": "Bearer private"},
		},
	}

	sanitized := sanitizeSentryEvent(event, nil)
	if sanitized.Message != "Failed for [email] at [phone]" {
		t.Fatalf("unexpected redacted message: %s", sanitized.Message)
	}
	if sanitized.Request.URL != "https://www.convoreal.com/webhook" || sanitized.Request.Data != "" {
		t.Fatalf("request was not sanitized: %#v", sanitized.Request)
	}
	if sanitized.User.Email != "" || sanitized.Extra != nil {
		t.Fatal("identity or extra data survived sanitization")
	}
}

func TestHealthzRequiresRedis(t *testing.T) {
	original := redisClient
	redisClient = nil
	t.Cleanup(func() { redisClient = original })

	recorder := httptest.NewRecorder()
	handleHealthz(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without Redis, got %d", recorder.Code)
	}
}
