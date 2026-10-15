package app

import (
	"fmt"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/retrieval"
)

// PrepareContext 先于 HTTP CreateRun 执行。整个运行使用此输入，恢复不再装“最新值”。
func PrepareContext(cfg config.Config, scenario, runID string, base int) (manuscript.FrozenInput, error) {
	return prepareContext(cfg, scenario, runID, base, nil)
}
func prepareContext(cfg config.Config, scenario, runID string, base int, result *retrieval.Result) (manuscript.FrozenInput, error) {
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
	opts := contextassembly.Options{RunID: runID, BaseDraftVersion: base, Budget: budget, ReservedOutputTokens: output, Excluded: demo.ExcludedContext()}
	if result != nil {
		bundle.POVCharacterID = result.Context.View.POV
		opts.Memory = &result.Context
		opts.Excluded = []manuscript.ExcludedSource{{Title: "检索范围", Reason: "只读取已固定的材料版本；作者规划不进入角色上下文。模式：" + result.Context.Mode}}
		if len(result.Excluded) > 0 {
			opts.Excluded = append(opts.Excluded, manuscript.ExcludedSource{Title: "可见性过滤", Reason: fmt.Sprintf("%d 条材料因版本、故事时间或角色知情范围不符而被排除", len(result.Excluded))})
		}
		if len(result.Context.Hits) == 0 {
			opts.Excluded = append(opts.Excluded, manuscript.ExcludedSource{Title: "相关前情", Reason: "当前没有可用检索结果；这不代表前文不存在约束"})
		}
	}
	return contextassembly.Assemble(bundle, demo.PreviousChapter(), opts)
}
