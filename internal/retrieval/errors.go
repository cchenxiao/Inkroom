package retrieval

import "fmt"

// Failure reports the failed operation without exposing provider bodies or SQL.
type Failure struct {
	Code, Message string
	Cause         error
}

func (e *Failure) Error() string { return fmt.Sprintf("%s: %v", e.Message, e.Cause) }
func (e *Failure) Unwrap() error { return e.Cause }
func failed(code, message string, cause error) error {
	return &Failure{Code: code, Message: message, Cause: cause}
}
