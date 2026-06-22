# Stage 1: Build the Go binary
FROM golang:1.24.3-alpine AS builder
WORKDIR /app

# Copy dependency manifests and download modules
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY main.go ./

# Build a statically linked binary for Linux
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o ingress-server .

# Stage 2: Final runner image
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/

# Copy the binary from the builder stage
COPY --from=builder /app/ingress-server .

EXPOSE 8080
ENV PORT=8080

CMD ["./ingress-server"]
