package app

import (
	"context"
	"encoding/json"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"os"
	"reflect"
	"testing"
	"time"
)

type trialSpy struct {
	inputs     []model.Input
	afterFirst func()
}

func (s *trialSpy) Generate(_ context.Context, in model.Input) (model.Output, model.Usage, error) {
	s.inputs = append(s.inputs, in)
	if len(s.inputs) == 1 && s.afterFirst != nil {
		s.afterFirst()
	}
	return model.Output{Content: `{"text":"他接过手电筒。两人继续寻找。"}`, FinishReason: model.Complete}, model.Usage{InputTokens: 100, OutputTokens: 20, Known: true}, nil
}
func trialFixture(t *testing.T) (planning.TrialInput, config.Config) {
	t.Helper()
	raw, err := os.ReadFile("../demo/style_trial.json")
	if err != nil {
		t.Fatal(err)
	}
	var input planning.TrialInput
	if err = json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	return input, config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 4, MaxTokens: 40000, MaxOutputTokens: 2048, CallTimeout: time.Second}
}
func TestTrialFreezesSceneAndOnlyChangesStyle(t *testing.T) {
	input, cfg := trialFixture(t)
	spy := &trialSpy{afterFirst: func() { input.Beat.Facts[0] = "外部状态在第一次调用后变化" }}
	report, err := generateStyleTrials(context.Background(), cfg, input, spy)
	if err != nil {
		t.Fatal(err)
	}
	if len(spy.inputs) != 2 || len(report.Samples) != 2 || report.Status != "completed" {
		t.Fatal("two samples required")
	}
	var a, b trialMaterial
	if err = json.Unmarshal(spy.inputs[0].Material, &a); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(spy.inputs[1].Material, &b); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a.Beat, b.Beat) || !reflect.DeepEqual(a.Direction, b.Direction) || a.Style.ID == b.Style.ID {
		t.Fatal("common scene changed or style did not change")
	}
	if a.Beat.Facts[0] == input.Beat.Facts[0] {
		t.Fatal("caller mutation leaked into frozen material")
	}
	if spy.inputs[0].PromptVersion != "trial_writer.v1" || spy.inputs[0].SchemaVersion != "trial_writer.v1" {
		t.Fatal("wrong prompt or schema")
	}
	if report.Samples[0].Stats.Calibrated || report.Usage.InputTokens != 200 {
		t.Fatal("stats must be uncalibrated and usage must be actual")
	}
}
func TestTrialRejectsStaleDirectionBeforeCallingModel(t *testing.T) {
	input, cfg := trialFixture(t)
	input.Source = planning.Snapshot(2, input.Source.Intake)
	spy := &trialSpy{}
	_, err := generateStyleTrials(context.Background(), cfg, input, spy)
	if err == nil || len(spy.inputs) != 0 {
		t.Fatal("stale direction reached model")
	}
}
func TestTrialBudgetFailurePreservesOnlyCompletedSample(t *testing.T) {
	input, cfg := trialFixture(t)
	cfg.MaxCalls = 1
	spy := &trialSpy{}
	report, err := generateStyleTrials(context.Background(), cfg, input, spy)
	if !errors.Is(err, model.ErrBudgetExhausted) || report.Status != "failed" || len(report.Samples) != 1 || len(spy.inputs) != 1 {
		t.Fatalf("unexpected partial result: status=%s samples=%d err=%v", report.Status, len(report.Samples), err)
	}
	if len(report.Calls) != 2 || report.Calls[0].Phase != "started" || report.Calls[1].Phase != "finished" {
		t.Fatal("call trace lost")
	}
}
