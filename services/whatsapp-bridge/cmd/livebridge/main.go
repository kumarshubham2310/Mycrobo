package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	waStore "go.mau.fi/whatsmeow/store"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/httpapi"
	"mycrobo/whatsapp-bridge/internal/store"
	"mycrobo/whatsapp-bridge/internal/whatsmeowlive"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8765", "loopback listen address")
	messagesDB := flag.String("messages-database", "mycrobo-messages.db", "durable normalized message database")
	sessionDB := flag.String("session-database", "mycrobo-linked-device.db", "durable linked-device session database")
	apiToken := flag.String("api-token", os.Getenv("MYCROBO_BRIDGE_TOKEN"), "per-launch gateway authorization token (minimum 32 characters)")
	connect := flag.Bool("connect", false, "connect the read-only linked-device adapter")
	acceptRisk := flag.Bool("accept-unofficial-risk", false, "confirm the personal linked-device connector is unofficial")
	enableTextSend := flag.Bool("enable-text-send", false, "enable exact-approval text sending; never enables automatic sending")
	mediaCacheMiB := flag.Int64("media-cache-mib", 128, "maximum re-fetchable full-media cache in MiB")
	parentPID := flag.Int("parent-pid", 0, "desktop parent process whose lifetime owns this private bridge")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || !(host == "127.0.0.1" || host == "::1" || host == "localhost") {
		log.Fatal("bridge must bind to loopback")
	}
	if *connect && !*acceptRisk {
		log.Fatal("-connect requires explicit -accept-unofficial-risk consent")
	}
	if len(*apiToken) < 32 {
		log.Fatal("bridge requires a per-launch API token of at least 32 characters")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *parentPID > 0 {
		go watchParent(ctx, *parentPID, stop)
	}

	waStore.SetOSInfo("Chrome (Windows)", waStore.GetWAVersion())
	waStore.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()
	fetchCtx, fetchCancel := context.WithTimeout(ctx, 4*time.Second)
	if latestVer, verErr := whatsmeow.GetLatestVersion(fetchCtx, nil); verErr == nil && latestVer != nil {
		waStore.SetWAVersion(*latestVer)
		waStore.SetOSInfo("Chrome (Windows)", *latestVer)
		log.Printf("using live WhatsApp web client version: %s", latestVer.String())
	}
	fetchCancel()
	messageStorePath := *messagesDB
	messageStoreKey := os.Getenv("MYCROBO_MESSAGE_DB_KEY")
	var repo *store.SQLite
	if messageStoreKey != "" {
		messageStorePath = store.EncryptedSQLitePath(*messagesDB)
		if _, statErr := os.Stat(messageStorePath); os.IsNotExist(statErr) {
			if _, sourceErr := os.Stat(*messagesDB); sourceErr == nil {
				if migrateErr := store.MigrateSQLiteToEncrypted(ctx, *messagesDB, messageStorePath, messageStoreKey); migrateErr != nil {
					log.Fatal(migrateErr)
				}
			}
		}
		repo, err = store.OpenSQLiteEncrypted(ctx, messageStorePath, messageStoreKey)
	} else {
		repo, err = store.OpenSQLite(ctx, messageStorePath)
	}
	if err != nil {
		log.Fatal(err)
	}
	defer repo.Close()
	if *mediaCacheMiB < 32 || *mediaCacheMiB > 2048 {
		log.Fatal("-media-cache-mib must be between 32 and 2048")
	}
	mediaCacheLimit := *mediaCacheMiB * 1024 * 1024
	storage, err := repo.MaintainStorage(ctx, mediaCacheLimit, true)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("storage ready: encrypted=%t database=%d MiB journal=%d MiB media-cache=%d/%d MiB reclaimed=%d MiB",
		messageStoreKey != "",
		storage.DatabaseBytes/(1024*1024), storage.JournalBytes/(1024*1024), storage.CachedMediaBytes/(1024*1024), storage.MediaCacheLimit/(1024*1024), storage.ReclaimedMediaBytes/(1024*1024))
	broker := httpapi.NewBroker()
	service := bridge.New(repo, nil, broker, false)
	sessionStorePath := *sessionDB
	var live *whatsmeowlive.Live
	if messageStoreKey != "" {
		sessionStorePath = store.EncryptedSQLitePath(*sessionDB)
		if _, statErr := os.Stat(sessionStorePath); os.IsNotExist(statErr) {
			if _, sourceErr := os.Stat(*sessionDB); sourceErr == nil {
				if migrateErr := store.MigrateSQLiteToEncrypted(ctx, *sessionDB, sessionStorePath, messageStoreKey); migrateErr != nil {
					log.Fatal(migrateErr)
				}
			}
		}
		live, err = whatsmeowlive.OpenEncrypted(ctx, sessionStorePath, service, messageStoreKey)
	} else {
		live, err = whatsmeowlive.Open(ctx, sessionStorePath, service)
	}
	if err != nil {
		log.Fatal(err)
	}
	defer live.Close()
	live.SetExpectedAccountScopeID(os.Getenv("MYCROBO_EXPECTED_ACCOUNT_SCOPE_ID"))
	service.SetTransport(live, *enableTextSend)
	var connectionStarted atomic.Bool
	startConnection := func() bool {
		if !connectionStarted.CompareAndSwap(false, true) {
			return false
		}
		go func() {
			if runErr := live.Start(ctx); runErr != nil && !errors.Is(runErr, context.Canceled) {
				log.Printf("linked-device connection stopped: %v", runErr)
			}
		}()
		return true
	}
	// Durable all-chat consent resumes the connector on every app launch. A
	// valid paired device reconnects silently; an unpaired or revoked device
	// prepares a fresh QR/phone flow without asking for the same approval again.
	if service.CanResumeImport(ctx) {
		startConnection()
	}

	root := http.NewServeMux()
	root.HandleFunc("GET /v1/link", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(response).Encode(live.Pairing())
	})
	root.HandleFunc("POST /v1/link/start", func(response http.ResponseWriter, request *http.Request) {
		var input struct {
			ImportAllChats         bool `json:"import_all_chats"`
			IncludeArchivedChats   bool `json:"include_archived_chats"`
			UnofficialRiskAccepted bool `json:"unofficial_risk_accepted"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 4096))
		decoder.DisallowUnknownFields()
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			http.Error(response, "invalid consent request", http.StatusBadRequest)
			return
		}
		consent, consentErr := service.RecordImportConsent(request.Context(), "personal-pilot-import-v1", input.ImportAllChats, input.IncludeArchivedChats, input.UnofficialRiskAccepted)
		if consentErr != nil {
			http.Error(response, consentErr.Error(), http.StatusForbidden)
			return
		}
		started := startConnection()
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		response.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(response).Encode(map[string]any{"started": started, "consent_id": consent.ID})
	})
	root.HandleFunc("GET /v1/link/qr.png", func(response http.ResponseWriter, request *http.Request) {
		snapshot := live.Pairing()
		if snapshot.State != "scan-required" || snapshot.Code == "" || (!snapshot.ExpiresAt.IsZero() && time.Now().UTC().After(snapshot.ExpiresAt)) {
			if fresh, qrErr := live.UseQR(request.Context()); qrErr == nil && fresh.Code != "" {
				snapshot = fresh
			}
		}
		response.Header().Set("Cache-Control", "no-store")
		if snapshot.State != "scan-required" || snapshot.Code == "" {
			http.Error(response, "pairing code is not available", http.StatusNotFound)
			return
		}
		if !snapshot.ExpiresAt.IsZero() && time.Now().UTC().After(snapshot.ExpiresAt) {
			http.Error(response, "pairing code expired", http.StatusGone)
			return
		}
		png, encodeErr := qrcode.Encode(snapshot.Code, qrcode.Medium, 320)
		if encodeErr != nil {
			http.Error(response, "pairing code could not be rendered", http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "image/png")
		_, _ = response.Write(png)
	})
	root.HandleFunc("POST /v1/link/phone", func(response http.ResponseWriter, request *http.Request) {
		var input struct {
			Phone string `json:"phone"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 1024))
		decoder.DisallowUnknownFields()
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			http.Error(response, "invalid phone-pairing request", http.StatusBadRequest)
			return
		}
		snapshot, pairErr := live.PairPhone(request.Context(), input.Phone)
		if pairErr != nil {
			http.Error(response, pairErr.Error(), http.StatusConflict)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		response.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(response).Encode(snapshot)
	})
	root.HandleFunc("POST /v1/link/qr", func(response http.ResponseWriter, request *http.Request) {
		snapshot, qrErr := live.UseQR(request.Context())
		if qrErr != nil {
			http.Error(response, qrErr.Error(), http.StatusConflict)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(response).Encode(snapshot)
	})
	root.HandleFunc("POST /v1/link/restart", func(response http.ResponseWriter, request *http.Request) {
		snapshot, restartErr := live.RestartPairing(request.Context())
		if restartErr != nil {
			http.Error(response, restartErr.Error(), http.StatusConflict)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(response).Encode(snapshot)
	})
	root.HandleFunc("POST /v1/link/logout", func(response http.ResponseWriter, request *http.Request) {
		var input struct {
			Confirm string `json:"confirm"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 1024))
		decoder.DisallowUnknownFields()
		if decodeErr := decoder.Decode(&input); decodeErr != nil || input.Confirm != "LOG OUT WHATSAPP" {
			http.Error(response, "explicit logout confirmation is required", http.StatusConflict)
			return
		}
		if logoutErr := live.Logout(request.Context()); logoutErr != nil {
			http.Error(response, logoutErr.Error(), http.StatusConflict)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"logged_out":              true,
			"local_history_preserved": true,
		})
	})
	root.HandleFunc("GET /v1/freshness", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(response).Encode(live.Freshness())
	})
	root.HandleFunc("GET /v1/storage", func(response http.ResponseWriter, request *http.Request) {
		stats, statsErr := repo.StorageStats(request.Context(), mediaCacheLimit)
		if statsErr != nil {
			http.Error(response, "storage status is unavailable", http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(response).Encode(stats)
	})
	root.Handle("/", httpapi.New(service, broker, live).Handler())
	server := &http.Server{Addr: *listen, Handler: httpapi.LoopbackOnly(httpapi.RequireBearer(root, *apiToken)), ReadHeaderTimeout: 5 * time.Second}

	if *connect {
		if _, consentErr := service.RecordImportConsent(ctx, "personal-pilot-cli-v1", true, true, true); consentErr != nil {
			log.Fatal(consentErr)
		}
		startConnection()
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if _, maintainErr := repo.MaintainStorage(context.Background(), mediaCacheLimit, false); maintainErr != nil {
					log.Printf("storage maintenance deferred: %v", maintainErr)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	outboundState := "text sending disabled"
	if *enableTextSend {
		outboundState = "exact-approval-gated text sending enabled"
	}
	log.Printf("MyCrobo live bridge listening on %s (analysis read-only; %s)", *listen, outboundState)
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func watchParent(ctx context.Context, parentPID int, stop context.CancelFunc) {
	watchParentWithInterval(ctx, parentPID, stop, 2*time.Second, parentProcessAlive)
}

func watchParentWithInterval(ctx context.Context, parentPID int, stop context.CancelFunc, interval time.Duration, alive func(int) bool) {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !alive(parentPID) {
				stop()
				return
			}
		}
	}
}
