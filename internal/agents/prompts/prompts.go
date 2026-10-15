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

type prompted struct{ next model.ChatModel }

func (p *prompted) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	in, err := Render(in)
	if err != nil {
		return model.Output{}, model.Usage{}, err
	}
	return p.next.Generate(ctx, in)
}

func Render(in model.Input) (model.Input, error) {
	name := in.Role
	in.Temperature = 0.2
	switch name {
	case "writer":
		in.Temperature = 0.8
	case "ai_taste":
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
	if name == "ai_taste" {
		promptVersion = "ai_taste.v2"
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
	if in.Role == "ai_taste" {
		in.SchemaVersion = "critic.v1"
	}
	return in, nil
}
