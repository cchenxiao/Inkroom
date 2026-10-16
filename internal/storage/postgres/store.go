// Package postgres 实现 I6 持久化，不承担 Agent checkpoint/resume。
package postgres

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
)

//go:embed migrations/001_core.sql
var migration string

//go:embed migrations/002_human.sql
var humanMigration string

//go:embed migrations/003_events.sql
var eventMigration string

//go:embed migrations/004_commits.sql
var commitMigration string

//go:embed migrations/005_memory.sql
var memoryMigration string

//go:embed migrations/006_preparation.sql
var preparationMigration string

//go:embed migrations/007_critic_lookup.sql
var criticLookupMigration string

//go:embed migrations/008_knowledge.sql
var knowledgeMigration string

//go:embed migrations/009_planning.sql
var planningMigration string

//go:embed migrations/010_style_trials.sql
var styleTrialsMigration string

//go:embed migrations/011_style_analysis.sql
var styleAnalysisMigration string

//go:embed migrations/012_core_settings.sql
var coreSettingsMigration string

//go:embed migrations/013_outline.sql
var outlineMigration string

//go:embed migrations/014_chapter_plan.sql
var chapterPlanMigration string

//go:embed migrations/015_planned_runs.sql
var plannedRunsMigration string

type Store struct {
	pool  *pgxpool.Pool
	lease *pgx.Conn
}

var _ app.Repository = (*Store)(nil)

// Open 校验迁移并持有独立会话锁，避免第二个服务误把仍在运行的任务标记中断。
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("invalid database configuration")
	}
	cfg.MaxConns = 6
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "10000"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("cannot initialize database pool")
	}
	s := &Store{pool: pool}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("cannot connect to PostgreSQL; check INKLOOM_DATABASE_URL")
	}
	s.lease, err = pgx.ConnectConfig(ctx, cfg.ConnConfig.Copy())
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("cannot acquire database service session")
	}
	var held bool
	err = s.lease.QueryRow(ctx, "SELECT pg_try_advisory_lock(730061,1)").Scan(&held)
	if err != nil || !held {
		s.Close()
		return nil, fmt.Errorf("another Inkloom service owns this database")
	}
	if err = s.migrate(ctx); err != nil {
		s.Close()
		return nil, err
	}
	if err = s.recoverInterrupted(ctx); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() {
	if s.lease != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = s.lease.Close(ctx)
	}
	s.pool.Close()
}
func (s *Store) Ping(ctx context.Context) error { return s.lease.Ping(ctx) }
func (s *Store) migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL)"); err != nil {
		return err
	}
	for i, sql := range []string{migration, humanMigration, eventMigration, commitMigration, memoryMigration, preparationMigration, criticLookupMigration, knowledgeMigration, planningMigration, styleTrialsMigration, styleAnalysisMigration, coreSettingsMigration, outlineMigration, chapterPlanMigration, plannedRunsMigration} {
		version := i + 1
		checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(sql)))
		var existing string
		err = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE version=$1", version).Scan(&existing)
		if errors.Is(err, pgx.ErrNoRows) {
			if _, err = tx.Exec(ctx, sql); err != nil {
				return fmt.Errorf("apply migration %d: %w", version, err)
			}
			if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES($1,$2)", version, checksum); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if existing != checksum {
			return fmt.Errorf("migration %d changed after application; add a new migration", version)
		}
	}

	return tx.Commit(ctx)
}
func (s *Store) recoverInterrupted(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `UPDATE planning_chapter_plan_jobs SET status='interrupted',record=record || '{"status":"interrupted","message":"服务中断，未自动重发细纲生成；请手动重试。"}'::jsonb WHERE status='running'`); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE planning_chapter_plan_calls SET record=record || '{"phase":"unknown"}'::jsonb WHERE record->>'phase'='started'`); err != nil {
		return err
	}

	if _, err := s.pool.Exec(ctx, `UPDATE planning_outline_jobs SET status='interrupted',record=record || '{"status":"interrupted","message":"服务中断，未自动重发章纲生成；请手动重试。"}'::jsonb WHERE status='running'`); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE planning_outline_calls SET record=record || '{"phase":"unknown"}'::jsonb WHERE record->>'phase'='started'`); err != nil {
		return err
	}

	if _, err := s.pool.Exec(ctx, `UPDATE planning_core_jobs SET status='interrupted',record=record || '{"status":"interrupted","message":"服务中断，未自动重发设定生成；请手动重试。"}'::jsonb WHERE status='running'`); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE planning_core_calls SET record=record || '{"phase":"unknown"}'::jsonb WHERE record->>'phase'='started'`); err != nil {
		return err
	}

	if _, err := s.pool.Exec(ctx, `UPDATE planning_style_analyses SET status='interrupted',record=record || '{"status":"interrupted","message":"服务中断，未自动重发分析请求；请手动重试。"}'::jsonb WHERE status='running'`); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE planning_analysis_calls SET record=record || '{"phase":"unknown"}'::jsonb WHERE record->>'phase'='started'`); err != nil {
		return err
	}

	if _, err := s.pool.Exec(ctx, `UPDATE planning_style_jobs SET status='interrupted', record=jsonb_set(record,'{report}',record->'report' || '{"status":"interrupted","message":"服务中断，未自动重发试笔请求；请手动重新生成。"}'::jsonb) WHERE status='running'`); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE planning_style_calls SET record=record || '{"phase":"unknown"}'::jsonb WHERE record->>'phase'='started'`); err != nil {
		return err
	}

	if _, err := s.pool.Exec(ctx, `UPDATE planning_jobs SET status='interrupted', record=record || '{"status":"interrupted","message":"服务中断，未自动重发模型请求；请手动重新生成。"}'::jsonb WHERE status='running'`); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE planning_calls SET record=record || '{"phase":"unknown"}'::jsonb WHERE record->>'phase'='started'`); err != nil {
		return err
	}

	rows, err := s.pool.Query(ctx, "SELECT id FROM runs WHERE status='running'")
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	// 恢复中的调用状态也走同一记账事务，保证 model.unknown 可被断线客户端补齐。
	callRows, err := s.pool.Query(ctx, "SELECT run_id,record FROM llm_calls WHERE phase='started'")
	if err != nil {
		return err
	}
	type pendingCall struct {
		id     string
		record model.CallRecord
	}
	pending := []pendingCall{}
	for callRows.Next() {
		var p pendingCall
		var raw []byte
		if err = callRows.Scan(&p.id, &raw); err != nil {
			callRows.Close()
			return err
		}
		if err = json.Unmarshal(raw, &p.record); err != nil {
			callRows.Close()
			return err
		}
		p.record.Phase = "unknown"
		pending = append(pending, p)
	}
	err = callRows.Err()
	callRows.Close()
	if err != nil {
		return err
	}
	for _, p := range pending {
		if err = s.RecordCall(ctx, p.id, p.record); err != nil {
			return err
		}
	}
	for _, id := range ids {
		if err = s.StopRun(ctx, id, "interrupted", "服务曾中断，保留已落库候选；本阶段不自动续跑或重发模型调用"); err != nil {
			return err
		}
	}
	return nil
}
func decodeRun(raw []byte) (app.Run, error) {
	var r app.Run
	err := json.Unmarshal(raw, &r)
	return r, err
}
