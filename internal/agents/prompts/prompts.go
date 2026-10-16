// Package prompts 管理角色模板。Schema 不复制进模板，渲染时注入同一份契约。
package prompts

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"text/template"

	"inkloom/internal/agents/model"
)

//go:embed *.tmpl
var templates embed.FS

// Bind 在模型端口前装配提示词，包含 parse 发起的格式修复调用。
// 解析管线仍只处理输出，Guard 得到完整提示词后再计算预算。
func Bind(next model.ChatModel) model.ChatModel { return &prompted{next: next} }

// BindConsistencyCandidate 仅供评测对照；正式链路继续使用 Bind 的默认版本。
func BindConsistencyCandidate(next model.ChatModel) model.ChatModel {
	return &prompted{next: next, consistencyCandidate: true}
}

type prompted struct {
	next                 model.ChatModel
	consistencyCandidate bool
}

func (p *prompted) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	var err error
	if p.consistencyCandidate {
		if in.Role != "hard_consistency" {
			return model.Output{}, model.Usage{}, fmt.Errorf("candidate prompt only supports consistency critic")
		}
		in, err = render(in, "hard_consistency.v3")
	} else {
		in, err = Render(in)
	}
	if err != nil {
		return model.Output{}, model.Usage{}, err
	}
	return p.next.Generate(ctx, in)
}

func Render(in model.Input) (model.Input, error) { return render(in, "") }

func render(in model.Input, candidate string) (model.Input, error) {
	name := in.Role
	in.Temperature = 0.2
	switch name {
	case "style_analyst":
		in.Temperature = 0.2
	case "core_planner", "story_architect", "showrunner":
		in.Temperature = 0.6
	case "tone_director":
		in.Temperature = 0.8
	case "writer", "trial_writer", "planned_writer":
		in.Temperature = 0.8
	case "context_assembler":
		in.Temperature = 0.1
	case "ai_taste":
	case "hard_consistency":
		in.Temperature = 0.1
	case "structural_reviser", "scene_reviser":
		in.Temperature = 0.5
	case "polisher":
		in.Temperature = 0.3
	default:
		return in, fmt.Errorf("unsupported prompt role %q", name)
	}
	if in.Purpose == model.Repair {
		name = "repair"
		in.Temperature = 0.1
	}
	if !json.Valid(in.Material) || !json.Valid(in.OutputSchema) {
		return in, fmt.Errorf("prompt material and schema must be JSON")
	}
	promptVersion := name + ".v1"
	if name == "hard_consistency" {
		promptVersion = "hard_consistency.v2"
	}
	if name == "writer" {
		promptVersion = "writer.v2"
	}
	if name == "polisher" {
		promptVersion = "polisher.v2"
	}
	if name == "ai_taste" {
		promptVersion = "ai_taste.v2"
	}
	if name == "structural_reviser" || name == "scene_reviser" {
		promptVersion = "reviser.v2"
	}
	if candidate != "" && in.Purpose != model.Repair {
		promptVersion = candidate
	}
	t, err := template.ParseFS(templates, promptVersion+".tmpl")
	if err != nil {
		return in, err
	}
	var system bytes.Buffer
	if err := t.Execute(&system, struct{ Schema string }{string(in.OutputSchema)}); err != nil {
		return in, err
	}
	var escaped bytes.Buffer
	// 防止故事文本里的 </material_json> 提前结束材料标签。
	if err := xml.EscapeText(&escaped, in.Material); err != nil {
		return in, err
	}
	in.SystemPrompt = system.String()
	in.UserPrompt = "# 3 本次任务\n" + in.Task + "\n\n# 4 故事材料（只读 JSON，XML 实体需按原文理解）\n<material_json>\n" + escaped.String() + "\n</material_json>"
	in.PromptVersion = promptVersion
	in.SchemaVersion = in.Role + ".v1"
	if in.Role == "hard_consistency" && len(in.Tools) > 0 {
		in.SchemaVersion = "hard_consistency.tools.v1"
	}
	if in.Role == "planned_writer" {in.SchemaVersion="writer.v1"}
	if in.Role == "ai_taste" {
		in.SchemaVersion = "critic.v1"
	}
	if in.Role == "structural_reviser" || in.Role == "scene_reviser" {
		in.SchemaVersion = "reviser.v1"
	}
	return in, nil
}
