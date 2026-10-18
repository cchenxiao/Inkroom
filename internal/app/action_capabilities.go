package app

import "inkloom/internal/orchestration"

// Empty reason means allowed. These are operation gates, not a promise that an
// arbitrary payload or a later request will still match the current version.
func HumanActionBlocks(r Run) map[string]string {
	out := map[string]string{}
	for _, kind := range []string{"save_edits", "inline_edit", "rewrite", "propose_selection", "propose_finding", "edit_finding", "finding_decision", "apply_finding", "discard_finding", "review_batch", "approve", "instruct"} {
		reason := ""
		switch {
		case r.Dismissed:
			reason = "此候选已放弃，请回到当前稿"
		case r.Result == nil:
			reason = "正在读取正文，请稍候"
		case r.Status == "running":
			reason = "当前操作正在进行，请等待完成"
		case r.Status == "stale":
			reason = "版本或创作设定已变化，请保留修改并建立当前候选"
		case r.Status != "waiting_human":
			reason = "此版本已结束审核；修改将另存为新候选"
		case !r.CanResume:
			reason = "审核状态尚未就绪，请更新状态"
		default:
			reason = orchestration.HumanActionBlock(*r.Result, kind)
		}
		out[kind] = reason
	}
	out["commit"] = CommitBlock(r)
	return out
}

// CommitBlock is shared by the read model and the locked adoption transaction.
// Payload digests and persisted approval receipts are still checked in that transaction.
func CommitBlock(r Run) string {
	if r.Dismissed {
		return "此候选已放弃，请回到当前稿"
	}
	if r.PendingAction != nil || r.Status == "running" {
		return "当前操作正在进行，请等待完成后采用"
	}
	if r.Status == "stale" && r.ApprovalBlock != "" {
		return r.ApprovalBlock
	}
	if r.Result != nil {
		if reason := orchestration.ApprovalReason(*r.Result); reason != "" {
			return reason
		}
	}
	if r.Status != "approved" || r.Result == nil {
		return "请先完成当前候选的审核并批准，再采用正文"
	}
	return ""
}
