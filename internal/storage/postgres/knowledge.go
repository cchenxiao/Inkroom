package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
)

type KnowledgePublication struct {
	ExpectedVersion int                `json:"expectedVersion"`
	ConfirmFacts    bool               `json:"confirmFacts"` // 作者声明已核对事实与知情来源，不由模型自行批准。
	Reason          string             `json:"reason"`
	Snapshot        knowledge.Snapshot `json:"snapshot"`
}
type StoredKnowledge struct {
	Digest    string             `json:"digest"`
	Origin    string             `json:"origin"`
	Reason    string             `json:"reason"`
	CreatedAt time.Time          `json:"createdAt"`
	Snapshot  knowledge.Snapshot `json:"snapshot"`
}

func (s *Store) PublishKnowledge(ctx context.Context, in KnowledgePublication) (StoredKnowledge, error) {
	return s.publishKnowledge(ctx, in, "human")
}

// SeedKnowledge 仅供显式教学命令；不把教学来源伪装为作者确认的正式作品。
func (s *Store) SeedKnowledge(ctx context.Context, snapshot knowledge.Snapshot) (StoredKnowledge, error) {
	return s.publishKnowledge(ctx, KnowledgePublication{Snapshot: snapshot, ExpectedVersion: 0, ConfirmFacts: true, Reason: "显式导入 I12 教学知识快照"}, "teaching_seed")
}
func (s *Store) publishKnowledge(ctx context.Context, in KnowledgePublication, origin string) (StoredKnowledge, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return StoredKnowledge{}, err
	}
	defer tx.Rollback(context.Background())
	saved, err := publishKnowledgeTx(ctx, tx, in, origin)
	if err != nil {
		return StoredKnowledge{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return StoredKnowledge{}, err
	}
	return saved, nil
}

// Called after the planning lock when publishing from confirmed planning.
func publishKnowledgeTx(ctx context.Context, tx pgx.Tx, in KnowledgePublication, origin string) (StoredKnowledge, error) {
	empty := StoredKnowledge{}
	if !in.ConfirmFacts || in.ExpectedVersion < 0 || in.Snapshot.Version != in.ExpectedVersion+1 || strings.TrimSpace(in.Reason) == "" || len(in.Reason) > 2000 {
		return empty, app.ErrInvalidWrite
	}
	records, err := knowledge.Records(in.Snapshot)
	if err != nil {
		return empty, fmt.Errorf("%w: %v", app.ErrInvalidWrite, err)
	}
	raw, err := json.Marshal(in.Snapshot)
	if err != nil || len(raw) > 1<<20 || len(records) > 512 {
		return empty, app.ErrInvalidWrite
	}
	// 同已有同步检索一样限制单条材料，避免发布后才发现无法装配。
	for _, r := range records {
		if len(r.Text) > 16000 {
			return empty, app.ErrInvalidWrite
		}
	}
	digest, err := manuscript.ContentDigest(in.Snapshot)
	if err != nil {
		return empty, err
	}
	project, branch := in.Snapshot.ProjectID, in.Snapshot.BranchID
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "knowledge/"+project+"/"+branch); err != nil {
		return empty, err
	}
	var version int
	var current string
	err = tx.QueryRow(ctx, "SELECT version,digest FROM knowledge_heads WHERE project_id=$1 AND branch_id=$2 FOR UPDATE", project, branch).Scan(&version, &current)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return empty, err
	}
	if current == digest {
		existing, e := readKnowledge(ctx, tx, project, branch, version)
		if e != nil {
			return empty, e
		}
		if existing.Origin != origin || existing.Reason != in.Reason {
			return empty, app.ErrVersionMismatch
		}
		return existing, nil
	}
	if version != in.ExpectedVersion {
		return empty, app.ErrVersionMismatch
	}
	saved := StoredKnowledge{Digest: digest, Origin: origin, Reason: in.Reason, Snapshot: in.Snapshot}
	err = tx.QueryRow(ctx, `INSERT INTO knowledge_snapshots(digest,project_id,branch_id,version,snapshot,origin,reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING created_at`, digest, project, branch, in.Snapshot.Version, raw, origin, in.Reason).Scan(&saved.CreatedAt)
	if err != nil {
		return empty, err
	}
	// 只替换知识投影目录；正文提交和旧教学 memory_seed 来源不受影响。
	if _, err = tx.Exec(ctx, "DELETE FROM memory_heads WHERE project_id=$1 AND branch_id=$2 AND id LIKE 'knowledge/%'", project, branch); err != nil {
		return empty, err
	}
	recordOrigin := "knowledge"
	if origin == "teaching_seed" {
		recordOrigin = "teaching_seed"
	}
	for _, r := range records {
		r.ID = "knowledge/" + r.ID
		r.Version = in.Snapshot.Version // 来源版本包含文本与知情元数据，不能仅沿用 Fact.Version。
		r.Knowledge = &memory.KnowledgeRef{Version: in.Snapshot.Version, Digest: digest}
		recordDigest := memory.Digest(r)
		recordJSON, _ := json.Marshal(r)
		if _, err = tx.Exec(ctx, `INSERT INTO memory_records(digest,project_id,branch_id,id,version,record,origin,knowledge_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, recordDigest, project, branch, r.ID, r.Version, recordJSON, recordOrigin, digest); err != nil {
			return empty, err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO memory_heads VALUES($1,$2,$3,$4)", project, branch, r.ID, recordDigest); err != nil {
			return empty, err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO knowledge_heads VALUES($1,$2,$3,$4) ON CONFLICT(project_id,branch_id) DO UPDATE SET version=EXCLUDED.version,digest=EXCLUDED.digest`, project, branch, in.Snapshot.Version, digest); err != nil {
		return empty, err
	}
	return saved, nil
}

type knowledgeQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// GetKnowledge version=0 读取当前 head；指定版本读取历史，校验身份与摘要后才返回作者台账。
func (s *Store) GetKnowledge(ctx context.Context, project, branch string, version int) (StoredKnowledge, error) {
	return readKnowledge(ctx, s.pool, project, branch, version)
}
func readKnowledge(ctx context.Context, q knowledgeQuerier, project, branch string, version int) (StoredKnowledge, error) {
	var out StoredKnowledge
	if strings.TrimSpace(project) == "" || strings.TrimSpace(branch) == "" || version < 0 {
		return out, app.ErrInvalidWrite
	}
	var raw []byte
	var storedVersion int
	err := q.QueryRow(ctx, `SELECT k.digest,k.origin,k.reason,k.created_at,k.snapshot,k.version FROM knowledge_snapshots k
 WHERE k.project_id=$1 AND k.branch_id=$2 AND k.version=CASE WHEN $3::integer=0 THEN (SELECT version FROM knowledge_heads WHERE project_id=$1 AND branch_id=$2) ELSE $3::integer END`, project, branch, version).Scan(&out.Digest, &out.Origin, &out.Reason, &out.CreatedAt, &raw, &storedVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, app.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &out.Snapshot); err != nil {
		return StoredKnowledge{}, err
	}
	digest, e := manuscript.ContentDigest(out.Snapshot)
	if e != nil || digest != out.Digest || out.Snapshot.ProjectID != project || out.Snapshot.BranchID != branch || out.Snapshot.Version != storedVersion {
		return StoredKnowledge{}, app.ErrContextMismatch
	}
	if err = out.Snapshot.Validate(); err != nil {
		return StoredKnowledge{}, err
	}
	return out, nil
}
