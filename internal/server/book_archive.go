package server

import (
	"context"
	"inkloom/internal/app"
	"net/http"
)

func (s *service) bookArchive(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repo.(interface {
		BookArchive(context.Context, string) (app.BookArchive, error)
	})
	if !ok {
		fail(w, 503, "archive_unavailable", "定稿资料存储暂不可用")
		return
	}
	out, err := repo.BookArchive(r.Context(), planningScope)
	if err != nil {
		storageError(w, err)
		return
	}
	if r.URL.Query().Get("format") == "text" {
		if len(out.Chapters) == 0 {
			fail(w, 409, "no_publications", "尚无已定稿章节，请先完成整章定稿。")
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="inkloom-published.txt"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(out.ExportText()))
		return
	}
	send(w, 200, out)
}
