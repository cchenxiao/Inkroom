package parse

import (
	"errors"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
)

// SchemaReason describes the failed contract without exposing generated values,
// provider responses or arbitrary extra property names.
func SchemaReason(err error) string {
	var validation *jsonschema.ValidationError
	if !errors.As(err, &validation) {
		return "模型返回的字段或结构不符合本次输出要求"
	}
	var reasons []string
	var visit func(*jsonschema.ValidationError)
	visit = func(e *jsonschema.ValidationError) {
		var reason string
		switch k := e.ErrorKind.(type) {
		case *kind.Required:
			reason = "缺少必填字段：" + strings.Join(k.Missing, "、")
		case *kind.Type:
			reason = "字段类型不符，应为 " + strings.Join(k.Want, " / ")
		case *kind.AdditionalProperties:
			reason = "返回了契约之外的字段"
		case *kind.MaxLength:
			reason = "返回文字超过字段长度上限"
		case *kind.MinLength:
			reason = "返回文字未达到字段最小长度"
		case *kind.Enum, *kind.Const:
			reason = "返回的选项不在允许范围内"
		}
		if reason != "" && len(reasons) < 3 {
			reasons = append(reasons, reason)
		}
		for _, cause := range e.Causes {
			visit(cause)
		}
	}
	visit(validation)
	if len(reasons) == 0 {
		return "模型返回的字段或结构不符合本次输出要求"
	}
	return "模型输出校验失败：" + strings.Join(reasons, "；")
}
