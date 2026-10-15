package app

import (
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
)

// PrepareContext 先于 HTTP CreateRun 执行。整个运行使用此输入，恢复不再装“最新值”。
func PrepareContext(cfg config.Config, scenario, runID string, base int) (manuscript.FrozenInput, error) {
	bundle, _, err := demo.Load(scenario)
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	budget, output := cfg.ContextTokens, cfg.MaxOutputTokens
	if budget == 0 {
		budget = 8000
	}
	if output == 0 {
		output = 2048
	}
	return contextassembly.Assemble(bundle, demo.PreviousChapter(), contextassembly.Options{RunID: runID, BaseDraftVersion: base, Budget: budget, ReservedOutputTokens: output, Excluded: demo.ExcludedContext()})
}
