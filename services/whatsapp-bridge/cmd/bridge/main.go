package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/httpapi"
	"mycrobo/whatsapp-bridge/internal/store"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8765", "loopback listen address")
	database := flag.String("database", "mycrobo-messages.db", "durable local message database")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || !(host == "127.0.0.1" || host == "::1" || host == "localhost") {
		log.Fatal("bridge must bind to loopback")
	}
	repo, err := store.OpenSQLite(context.Background(), *database)
	if err != nil {
		log.Fatal(err)
	}
	defer repo.Close()
	broker := httpapi.NewBroker()
	service := bridge.New(repo, nil, broker, false)
	log.Printf("MyCrobo bridge listening on %s (offline, durable, read-only, outbound disabled)", *listen)
	log.Fatal(http.ListenAndServe(*listen, httpapi.New(service, broker).Handler()))
}
