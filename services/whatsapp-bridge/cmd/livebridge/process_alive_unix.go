//go:build !windows

package main

import "syscall"

func parentProcessAlive(pid int) bool {
	return pid > 0 && syscall.Kill(pid, 0) == nil
}
