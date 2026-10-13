package main

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestParentProcessAlive(t *testing.T) {
	if !parentProcessAlive(os.Getpid()) {
		t.Fatal("the current bridge process must be reported alive")
	}
	if parentProcessAlive(0) {
		t.Fatal("pid zero must not be treated as a valid desktop owner")
	}
}

func TestParentWatchdogStopsBridgeAfterOwnerCrash(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopped := make(chan struct{}, 1)
	go watchParentWithInterval(ctx, 9911, func() { stopped <- struct{}{} }, time.Millisecond, func(pid int) bool {
		if pid != 9911 {
			t.Errorf("unexpected parent pid %d", pid)
		}
		return false
	})
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("bridge watchdog did not stop after the parent disappeared")
	}
}

func TestParentWatchdogDoesNotStopWhileOwnerRemainsAlive(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{}, 1)
	go watchParentWithInterval(ctx, 9912, func() { stopped <- struct{}{} }, time.Millisecond, func(int) bool { return true })
	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case <-stopped:
		t.Fatal("bridge watchdog stopped while the desktop owner was alive")
	case <-time.After(20 * time.Millisecond):
	}
}
