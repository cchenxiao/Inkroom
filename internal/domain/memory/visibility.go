package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// Digest 由可信来源快照生成并固定；读取候选记录时不能重新生成 Pin 来“通过校验”。
func Digest(r Record) string {
	raw, _ := json.Marshal(r) // Record 只有可 JSON 编码的值类型。
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}

// Select 在相关性排序之前执行。它只回答“可以用吗”，不回答“有用吗”。
// AuthorPlans 只供作者规划区域使用；角色装配和未来工具只消费 CharacterContext。
func Select(v View, records []Record) (Selection, error) {
	return selectRecords(v, records, false)
}

// SelectForAuthor exposes earlier published text for author inspection only.
// It never asserts that a POV character knows these materials. Agent retrieval
// and ValidateRetrieval continue to require explicit character knowledge.
func SelectForAuthor(v View, records []Record) (Selection, error) {
	if !v.CatalogBound {
		return Selection{}, fmt.Errorf("author search requires a pinned publication catalog")
	}
	return selectRecords(v, records, true)
}

func selectRecords(v View, records []Record, author bool) (Selection, error) {
	out := Selection{CharacterContext: []Material{}, AuthorPlans: []Material{}, Excluded: []Exclusion{}}
	if strings.TrimSpace(v.ProjectID) == "" || strings.TrimSpace(v.BranchID) == "" || strings.TrimSpace(v.POV) == "" || !validMoment(&v.At) {
		return out, fmt.Errorf("visibility requires project, branch, POV and explicit chapter/story time")
	}
	selected := map[string]bool{}
	for _, r := range records {
		if reason := excludedBy(v, r); reason != "" && !(author && (reason == UnknownToPOV || reason == KnowledgeLater)) {
			out.Excluded = append(out.Excluded, Exclusion{ID: r.ID, Reason: reason})
			continue
		}
		if selected[r.ID] {
			continue // 关键词和向量通道可能返回同一个固定版本。
		}
		selected[r.ID] = true
		m := Material{ID: r.ID, Version: r.Version, Digest: v.Pins[r.ID].Digest, Kind: r.Kind, ChapterID: r.ChapterID, SegmentID: r.SegmentID, Text: r.Text}
		if r.Kind == Plan {
			out.AuthorPlans = append(out.AuthorPlans, m)
		} else {
			out.CharacterContext = append(out.CharacterContext, m)
		}
	}
	return out, nil
}

func excludedBy(v View, r Record) Reason {
	// 先查来源身份，再查版本，最后查故事内可见范围。
	if r.ProjectID != v.ProjectID {
		return OtherProject
	}
	if r.BranchID != v.BranchID {
		return OtherBranch
	}
	if r.Status != Confirmed {
		return Unconfirmed
	}
	pin, ok := v.Pins[r.ID]
	if !ok {
		return NotPinned
	}
	if pin.Version != r.Version {
		return VersionMismatch
	}
	if pin.Digest != Digest(r) {
		return DigestMismatch
	}
	if strings.TrimSpace(r.ID) == "" || r.Version < 1 || strings.TrimSpace(r.Text) == "" || !validRecordMoment(r.At, r.Initial) {
		return InvalidRecord
	}
	if r.Kind != Fact && r.Kind != Passage && r.Kind != Plan {
		return InvalidRecord
	}
	if r.Initial != nil {
		if r.Kind != Fact || r.ChapterID != "" || r.SegmentID != "" {
			return InvalidRecord
		}
	} else if strings.TrimSpace(r.ChapterID) == "" || (r.Kind != Plan && strings.TrimSpace(r.SegmentID) == "") {
		return InvalidRecord
	}
	if r.Kind == Plan {
		return "" // 作者可规划未来，但 Select 只能把它放入独立 AuthorPlans。
	}
	if r.At.Chapter > v.At.Chapter {
		return FutureChapter
	}
	if r.At.StoryTime > v.At.StoryTime {
		return FutureStoryTime
	}
	later := false
	for _, k := range r.KnownBy {
		if k.CharacterID != v.POV || !validRecordMoment(k.Since, r.Initial) {
			continue
		}
		if k.Since.Chapter <= v.At.Chapter && k.Since.StoryTime <= v.At.StoryTime {
			return ""
		}
		later = true
	}
	if later {
		return KnowledgeLater
	}
	return UnknownToPOV
}

func validMoment(m *Moment) bool {
	return m != nil && m.Chapter > 0 && m.StoryTime >= 0
}

// 章 0 仅表示初始设定尚无正文出处；角色获知仍受独立故事时间约束。
func ValidInitial(s *InitialSetting) bool {
	if s == nil || strings.TrimSpace(s.ID) == "" || s.CoreVersion < 1 {
		return false
	}
	raw, err := hex.DecodeString(s.CoreDigest)
	return err == nil && len(raw) == 32
}
func validRecordMoment(m *Moment, initial *InitialSetting) bool {
	if initial == nil {
		return validMoment(m)
	}
	return ValidInitial(initial) && m != nil && m.Chapter == 0 && m.StoryTime >= 0
}
