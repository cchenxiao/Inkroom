package parse

import (
	"inkloom/internal/agents/model"
	"strings"
	"testing"
)

func TestSchemaReasonExplainsContractWithoutGeneratedValues(t *testing.T) {
	schema := []byte(`{"type":"object","additionalProperties":false,"required":["text"],"properties":{"text":{"type":"string"}}}`)
	for _, tc := range []struct{ raw, want string }{
		{`{"secret-generated-field":"private prose"}`, "缺少必填字段：text"},
		{`{"text":42}`, "字段类型不符，应为 string"},
	} {
		_, err := Decode[map[string]any](model.Output{FinishReason: model.Complete, Content: tc.raw}, schema, nil)
		reason := SchemaReason(err)
		if !strings.Contains(reason, tc.want) || strings.Contains(reason, "secret-generated-field") || strings.Contains(reason, "private prose") {
			t.Fatal(reason)
		}
	}
}
