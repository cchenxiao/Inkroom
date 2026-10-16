package app

import (
	"fmt"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/planning"
	"strings"
)

type KnowledgePublishRequest struct {
	Expected        planning.PlanningVersions `json:"expected"`
	ExpectedVersion int                       `json:"expectedVersion"`
	PreviewDigest   string                    `json:"previewDigest"`
	Confirm         bool                      `json:"confirm"`
	Reason          string                    `json:"reason"`
}
type KnowledgePreview struct {
	Ready            bool                      `json:"ready"`
	Reason           string                    `json:"reason"`
	Expected         planning.PlanningVersions `json:"expected"`
	ExpectedVersion  int                       `json:"expectedVersion"`
	PreviewDigest    string                    `json:"previewDigest"`
	ReplacesTeaching bool                      `json:"replacesTeaching"`
	CurrentVersion   int                       `json:"currentVersion"`
	Current          bool                      `json:"current"`
	Snapshot         *knowledge.Snapshot       `json:"snapshot"`
	Excluded         []KnowledgeExclusion      `json:"excluded"`
}
type KnowledgeExclusion struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// BuildPlanningKnowledge 不调用模型。发布作者已确认的事实和知情声明，不能替作者推断获知时点。
func BuildPlanningKnowledge(scope string, in planning.OutlineInput, version int) (knowledge.Snapshot, []KnowledgeExclusion, error) {
	s := knowledge.Snapshot{Version: version, Confirmed: true, Characters: []string{}, Facts: []knowledge.Fact{}, Information: []knowledge.InfoState{}, Timeline: []knowledge.TimelineEvent{}, Foreshadows: []knowledge.Foreshadow{}}
	excluded := []KnowledgeExclusion{}
	project, branch, ok := strings.Cut(scope, "/")
	if !ok || project == "" || branch != "main" {
		return s, excluded, ErrInvalidWrite
	}
	if err := in.Validate(); err != nil {
		return s, excluded, err
	}
	core, err := in.Confirmed()
	if err != nil {
		return s, excluded, err
	}
	digest, err := manuscript.ContentDigest(in.Core)
	if err != nil {
		return s, excluded, err
	}
	v := in.Versions
	s.ProjectID = project
	s.BranchID = branch
	s.Planning = &knowledge.PlanningSource{Input: v.Input, Direction: v.Direction, Style: v.Style, Core: v.Core, CoreDigest: digest}
	for _, c := range core.Characters {
		s.Characters = append(s.Characters, c.ID)
	}
	for _, f := range in.Core.Content.WorldFacts {
		if in.Core.Decisions[f.ID] != planning.CoreConfirmed {
			excluded = append(excluded, KnowledgeExclusion{f.ID, "事实未确认或已舍弃"})
			continue
		}
		if f.StoryTime == nil {
			excluded = append(excluded, KnowledgeExclusion{f.ID, "事实的故事时间未确认"})
			continue
		}
		source := &memory.InitialSetting{ID: f.ID, CoreVersion: v.Core, CoreDigest: digest}
		location := knowledge.Location{Initial: source, At: memory.Moment{Chapter: 0, StoryTime: *f.StoryTime}}
		s.Facts = append(s.Facts, knowledge.Fact{ID: f.ID, Version: v.Core, Text: f.Text, Source: location})
		for _, k := range f.KnownBy {
			if k.LearnedAt == nil {
				excluded = append(excluded, KnowledgeExclusion{f.ID + "/" + k.CharacterID, "获知时间未确认，不声明角色已知"})
				continue
			}
			s.Information = append(s.Information, knowledge.InfoState{FactID: f.ID, SubjectID: k.CharacterID, State: knowledge.Known, Source: knowledge.Location{Initial: source, At: memory.Moment{Chapter: 0, StoryTime: *k.LearnedAt}}})
		}
	}
	for _, p := range in.Core.Content.Plans {
		excluded = append(excluded, KnowledgeExclusion{p.ID, "未来计划不发布为已发生事实"})
	}
	if len(s.Facts) == 0 {
		return s, excluded, fmt.Errorf("至少确认一条有明确故事时间的事实后才能发布")
	}
	return s, excluded, s.Validate()
}

// FreezePublishedKnowledge 只把指定 POV/时点可见事实交给正文，不传完整作者台账。
func FreezePublishedKnowledge(input manuscript.FrozenInput, s knowledge.Snapshot) (manuscript.FrozenInput, error) {
	t := input.Bundle.WritingTask
	if t == nil || s.Planning == nil {
		return input, ErrContextMismatch
	}
	v := t.Versions
	p := s.Planning
	if v["input"] != p.Input || v["direction"] != p.Direction || v["style"] != p.Style || v["core"] != p.Core {
		return input, ErrVersionMismatch
	}
	selected, err := knowledge.Project(s, memory.View{ProjectID: input.Bundle.ProjectID, BranchID: input.Bundle.BranchID, POV: input.Bundle.POVCharacterID, At: memory.Moment{Chapter: 1, StoryTime: t.StoryTime}})
	if err != nil {
		return input, err
	}
	if len(selected.CharacterContext) == 0 {
		return input, fmt.Errorf("已发布知识中没有当前 POV/时间可用事实")
	}
	input.Bundle.Facts = []manuscript.SourceRef{}
	for _, f := range selected.CharacterContext {
		input.Bundle.Facts = append(input.Bundle.Facts, manuscript.SourceRef{ID: "knowledge/" + f.ID, Version: s.Version, Text: f.Text})
	}
	digest, err := manuscript.ContentDigest(s)
	if err != nil {
		return input, err
	}
	t.Knowledge = &memory.KnowledgeRef{Version: s.Version, Digest: digest}
	return ReassemblePlanned(input)
}
