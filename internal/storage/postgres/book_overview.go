package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
	"unicode"
)

// Reuse the same version/eligibility checks as assembly and publication, never demo totals.
// All reads share the planning lock with author writes. No record or model call is created.
func (s *Store) BookOverview(ctx context.Context, scope string) (app.BookOverview, error) {
	out := app.BookOverview{Scope: scope, Name: "浊流", NextSection: "premise", NextStage: "write", Confirmed: map[string]bool{}, Chapters: []app.BookChapter{}, Characters: []planning.CharacterDesign{}, Plans: []planning.FuturePlan{}}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.Background())
	state, err := readPlanning(ctx, tx, scope)
	if err != nil {
		return out, err
	}
	out.Premise, out.Genre, out.TargetWords = state.Input.Intake.Premise, state.Input.Intake.Genres, state.Input.Intake.TargetWords
	d, st, co, ol := state.Selection, state.StyleSelection, state.CoreSelection, state.OutlineSelection
	direction := d != nil && d.InputVersion == state.Input.Version && d.InputDigest == state.Input.Digest
	style := direction && st != nil && st.InputVersion == state.Input.Version && st.DirectionVersion == state.DirectionVersion
	core := style && co != nil && co.InputVersion == state.Input.Version && co.DirectionVersion == state.DirectionVersion && co.StyleVersion == state.StyleVersion
	versions := planning.PlanningVersions{Input: state.Input.Version, Direction: state.DirectionVersion, Style: state.StyleVersion, Core: state.CoreVersion}
	outline := core && ol != nil && ol.Confirmed && ol.Versions == versions
	out.Confirmed = map[string]bool{"direction": direction, "style": style, "world": core, "outline": outline}
	if direction {
		out.Premise = d.Direction.Logline
		out.NextSection = "style"
	}
	if style {
		rules := st.Rules
		out.Style = &rules
		out.NextSection = "world"
	}
	if core {
		for _, c := range co.Content.Characters {
			if co.Decisions[c.ID] == planning.CoreConfirmed {
				out.Characters = append(out.Characters, c)
			}
		}
		for _, p := range co.Content.Plans {
			if co.Decisions[p.ID] == planning.CoreConfirmed {
				out.Plans = append(out.Plans, p)
			}
		}
		if len(out.Characters) > 0 {
			out.NextSection = "outline"
		}
	}
	if ol == nil {
		return out, nil
	}
	for i, ch := range ol.Content.Chapters {
		c := app.BookChapter{ID: ch.ID, Title: ch.Title, Number: i + 1, TargetWords: planning.ChapterWordTarget(ch.TargetWords, 0), Status: "planned", Reason: "请先确认本章细纲", ReviewSummary: "尚无当前整章复审"}
		for _, a := range ol.Content.Acts {
			if a.ID == ch.ActID {
				c.Act = a.Title
			}
		}
		if !outline {
			c.Status = "stale"
			c.Reason = "章纲尚未确认或上游设定已变化"
		} else {
			p, e := assemblyPreview(ctx, tx, scope, app.AssemblyPreviewRequest{ChapterID: ch.ID})
			if e != nil {
				return out, e
			}
			c.Reason = p.Reason
			for _, plan := range state.ChapterPlans {
				if plan.ChapterID == ch.ID && plan.Confirmed && plan.Versions == (planning.ChapterPlanVersions{Planning: versions, Outline: state.OutlineVersion, Bindings: ol.BindingsVersion}) {
					c.TargetWords = planning.ChapterWordTarget(ch.TargetWords, plan.Content.TargetWords)
					if i == 0 {
						head, e := planningKnowledgeHead(ctx, tx, scope)
						if e != nil {
							return out, e
						}
						if !publishedForPlan(head, plan) {
							out.NextSection = "knowledge"
						}
					}
					for _, scene := range plan.Content.Scenes {
						c.TotalBeats += len(scene.Beats)
					}
				}
			}
			for _, slot := range p.Slots {
				if slot.Reason == "" && slot.Part.CommitID != "" {
					c.DoneBeats++
					for _, seg := range slot.Part.Segments {
						for _, r := range seg.Text {
							if !unicode.IsSpace(r) {
								c.AcceptedWords++
							}
						}
					}
				}
			}
			var runRaw []byte
			e = tx.QueryRow(ctx, "SELECT r.payload FROM runs r JOIN planning_run_inputs p ON p.run_id=r.id WHERE p.scope=$1 AND p.chapter_id=$2 AND COALESCE(r.payload->>'dismissed','false')<>'true' ORDER BY r.created_at DESC,r.id DESC LIMIT 1", scope, ch.ID).Scan(&runRaw)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return out, e
			}
			if e == nil {
				var run app.Run
				if e = json.Unmarshal(runRaw, &run); e != nil {
					return out, e
				}
				current, e := planningRunCurrent(ctx, tx, run.Planning)
				if e != nil {
					return out, e
				}
				if current && run.Planning != nil {
					c.Status = "drafting"
				}
			}

			if i == 0 && len(p.Slots) > 0 {
				out.CurrentChapterID = ch.ID
				out.NextSection = ""
				if p.Ready {
					out.NextStage = "assembly"
				}
			}
			if len(p.History) > 0 {
				a := p.History[0]
				current, e := assemblyCurrent(ctx, tx, a)
				if e != nil {
					return out, e
				}
				if current {
					c.Status = "in_review"
					c.Reason = "章稿已组好，等待整章复审与作者定稿"
					out.NextStage = "assembly"
					var raw []byte
					e = tx.QueryRow(ctx, "SELECT record FROM chapter_review_jobs WHERE scope=$1 AND assembly_id=$2 ORDER BY sequence DESC LIMIT 1", scope, a.ID).Scan(&raw)
					if e != nil && !errors.Is(e, pgx.ErrNoRows) {
						return out, e
					}
					if e == nil {
						var j app.ChapterReviewJob
						if e = json.Unmarshal(raw, &j); e != nil {
							return out, e
						}
						j, e = decorateChapterReview(ctx, tx, j)
						if e != nil {
							return out, e
						}
						if j.Current {
							c.ReviewSummary = j.ApprovalBlock
							if j.Status == "completed" {
								c.Status = "human"
							}
							if c.ReviewSummary == "" {
								c.ReviewSummary = "整章复审未发现阻断项，仍须作者决定与事实确认"
							}
							if j.Output != nil {
								for _, critic := range j.Output.Critics {
									for _, f := range critic.Findings {
										if f.Severity == "P0" {
											c.ReviewSummary = "P0 · " + f.Reason
										}
									}
								}
							}
						}
					}
				} else {
					c.Reason = "已有章稿来源过期，请核对段落并重新组稿"
				}
			}
		}
		var raw []byte
		e := tx.QueryRow(ctx, "SELECT record FROM chapter_publications WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 1", scope, ch.ID).Scan(&raw)
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return out, e
		}
		if e == nil {
			var pub app.ChapterPublication
			if e = json.Unmarshal(raw, &pub); e != nil {
				return out, e
			}
			valid, e := decoratePublication(ctx, tx, pub)
			if e != nil {
				return out, e
			}
			c.HistoricalPublication = !valid.Current
			if valid.Current {
				c.Status = "finalized"
				c.Reason = "当前章稿已由作者定稿"
				c.ReviewSummary = "当前有效定稿"
				out.FinalizedChapters++
			}
		}
		out.AcceptedWords += c.AcceptedWords
		out.DoneBeats += c.DoneBeats
		out.TotalBeats += c.TotalBeats
		out.Chapters = append(out.Chapters, c)
	}
	// Continue at the first unfinished chapter, never permanently pin the book to chapter one.
	if outline {
		for _, ch := range out.Chapters {
			if ch.Status == "finalized" {
				continue
			}
			out.CurrentChapterID, out.NextStage, out.NextSection = ch.ID, "write", ""
			if ch.TotalBeats == 0 {
				out.NextSection = "outline"
			} else {
				for _, plan := range state.ChapterPlans {
					if plan.ChapterID == ch.ID {
						head, e := planningKnowledgeHead(ctx, tx, scope)
						if e != nil {
							return out, e
						}
						if !publishedForPlan(head, plan) {
							out.NextSection = "knowledge"
						}
					}
				}
				if ch.DoneBeats == ch.TotalBeats || ch.Status == "in_review" || ch.Status == "human" {
					out.NextStage = "assembly"
				}
			}
			break
		}
	}
	return out, nil
}
