package review

import "inkloom/internal/domain/manuscript"

// Decision 先选修复粒度，再检查授权；RequiresHuman 不允许被“多数通过”抹掉。
type Decision struct {
	Kind       string   `json:"kind"` // none / micro / scene / structural / human
	TargetIDs  []string `json:"targetIds"`
	FindingIDs []string `json:"findingIds"`
	NeedsHuman bool     `json:"needsHuman"`
	Reason     string   `json:"reason"`
}

func Route(r Report, segments []manuscript.Segment, b manuscript.ContextBundle, micro, local bool) Decision {
	d := Decision{Kind: "none", TargetIDs: []string{}, FindingIDs: []string{}, Reason: "本轮两个必要评审已收齐，未发现阻断问题"}
	var highest Severity
	for _, f := range r.Findings {
		if f.RequiresHuman || f.PossibleDialogueLie {
			d.NeedsHuman = true
			d.Reason = "存在事实裁决、重大调整或台词真伪问题，须由作者确认"
		}
		if f.Severity != P3 && (highest == "" || f.Severity < highest) {
			highest = f.Severity
		}
	}
	switch highest {
	case P0:
		d.Kind = "structural"
	case P1:
		d.Kind = "scene"
	case P2:
		d.Kind = "micro"
	default:
		if d.NeedsHuman {
			d.Kind = "human"
		}
		return d
	}
	selected := map[string]bool{}
	for _, f := range r.Findings {
		// 所有阻断项都参与边界检查，不能让较低级别的跨章请求绕过 gate。
		if f.Severity != P3 && (f.RepairScope == "outline" || f.RepairScope == "cross_chapter") {
			d.NeedsHuman = true
			d.Reason = "涉及锁定大纲或跨章修改，先交作者确认方案"
		}
		if f.Severity != highest {
			continue
		}
		d.FindingIDs = append(d.FindingIDs, f.ID)
		for _, s := range segments {
			if s.ID != f.SegmentID {
				continue
			}
			if s.ChapterID != b.ChapterID || (highest == P0 && s.BeatID != b.Beat.ID) || (highest == P1 && s.SceneID != b.Beat.SceneID) {
				d.NeedsHuman = true
				d.Reason = "修复目标超出本次冻结的 Beat/场景范围"
			}
			for _, target := range segments {
				if target.ID == s.ID || (highest == P0 && target.BeatID == s.BeatID) || (highest == P1 && target.SceneID == s.SceneID) {
					selected[target.ID] = true
				}
			}
		}
	}
	for _, s := range segments {
		if selected[s.ID] {
			d.TargetIDs = append(d.TargetIDs, s.ID)
		}
	}
	if !d.NeedsHuman {
		if highest == P2 && !micro {
			d.NeedsHuman = true
			d.Reason = "尚未授权自动句级修订"
		} else if highest != P2 && !local {
			d.NeedsHuman = true
			d.Reason = "尚未授权本场/Beat 内局部重写；保留原稿和修复建议"
		} else {
			d.Reason = "在授权范围内修复当前候选稿，修改后重新并行评审"
		}
	}
	return d
}
