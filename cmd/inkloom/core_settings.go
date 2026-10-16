package main

import (
	"context"
	"encoding/json"
	"fmt"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"io"
	"os"
	"time"
)

func coreSettingsCommand(ctx context.Context, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	var input planning.CoreSettingsInput
	decoder := json.NewDecoder(io.LimitReader(file, 64*1024+1))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return fmt.Errorf("核心设定输入格式无效: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return fmt.Errorf("只接受一个核心设定输入对象，最多 64 KiB")
	}
	if err = input.Validate(); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	report, runErr := app.GenerateCoreSettings(ctx, cfg, input)
	if report.Status != "" {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err = encoder.Encode(report); err != nil {
			return err
		}
	}
	return runErr
}
