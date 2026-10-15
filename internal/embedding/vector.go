package embedding

import (
	"fmt"
	"math"
)

// Validate 拒绝维度漂移、NaN/Inf、零向量；pgvector 余弦距离需要非零范数。
func Validate(v []float32, dimension int) error {
	if len(v) < 1 || len(v) > 4096 || (dimension > 0 && len(v) != dimension) {
		return fmt.Errorf("invalid embedding dimension")
	}
	norm := float64(0)
	for _, x := range v {
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return fmt.Errorf("non-finite embedding")
		}
		norm += float64(x) * float64(x)
	}
	if norm == 0 {
		return fmt.Errorf("zero embedding")
	}
	return nil
}
