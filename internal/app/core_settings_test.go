package app

import (
	"context"
	"encoding/json"
	"inkloom/internal/domain/planning"
	"os"
	"strings"
	"testing"
)

func TestCoreSettingsKeepsReferencesAndAuthorMetadataOutsideKnowledge(t *testing.T) {
	raw, err := os.ReadFile("../demo/core_settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var input planning.CoreSettingsInput
	if err = json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	input.Style.AnchorText = "不可泄漏的参考人物甲乙丙"
	if strings.Contains(string(coreMaterial(input)), input.Style.AnchorText) {
		t.Fatal("reference story leaked into Planner")
	}
	_, cfg := trialFixture(t)
	report, err := GenerateCoreSettings(context.Background(), cfg, input)
	if err != nil {
		t.Fatal(err)
	}
	if report.Confirmation != "candidate" || len(report.Output.Plans) == 0 || len(report.Output.Characters) == 0 {
		t.Fatal("proposal partition missing")
	}
	for _, f := range report.Output.WorldFacts {
		if len(f.KnownBy) != 0 || strings.Contains(f.Text, report.Output.Characters[0].Need) {
			t.Fatal("metadata promoted to character knowledge")
		}
	}
	report.Output.Characters[0].HardFactIDs = []string{report.Output.WorldFacts[0].ID}
	report.Output.WorldFacts[0].Rigidity = "soft"
	if err = report.Output.Validate(); err == nil {
		t.Fatal("soft fact accepted as hard character trait")
	}
	input.Style.DirectionVersion++
	if _, err = GenerateCoreSettings(context.Background(), cfg, input); err == nil {
		t.Fatal("stale style accepted")
	}
}

func TestCoreSettingsRejectsNullCollections(t *testing.T) {
	for name, mutate := range map[string]func(*planning.CoreSettingsOutput){
		"facts": func(out *planning.CoreSettingsOutput) {
			out.Characters[0].HardFactIDs = []string{}
			out.WorldFacts = nil
		},
		"plans":           func(out *planning.CoreSettingsOutput) { out.Plans = nil },
		"hard references": func(out *planning.CoreSettingsOutput) { out.Characters[0].HardFactIDs = nil },
		"knowledge":       func(out *planning.CoreSettingsOutput) { out.WorldFacts[0].KnownBy = nil },
	} {
		t.Run(name, func(t *testing.T) {
			out := fakeCoreSettings()
			if err := out.Validate(); err != nil {
				t.Fatal(err)
			}
			mutate(&out)
			if err := out.Validate(); err == nil {
				t.Fatal("null collection accepted by JSON boundary")
			}
		})
	}
}
