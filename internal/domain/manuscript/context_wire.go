package manuscript

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// New chapter batches share identical material on the wire without dropping
// evidence. Domain consumers always receive fully expanded per-POV targets.
// Legacy bundles keep their original serialization and frozen digests.
type contextWire ContextBundle

var sharedContextFields = []string{"previousEnding", "facts", "characters", "bannedPhrases", "protectedTerms", "sources", "neighbors"}

func (b ContextBundle) MarshalJSON() ([]byte, error) {
	raw, err := json.Marshal(contextWire(b))
	if err != nil || !b.CompactTargets || len(b.Targets) == 0 {
		return raw, err
	}
	var root map[string]json.RawMessage
	if err = json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	var targets []map[string]json.RawMessage
	if err = json.Unmarshal(root["targets"], &targets); err != nil {
		return nil, err
	}
	for _, t := range targets {
		inherited := []string{}
		for _, key := range sharedContextFields {
			if v, ok := t[key]; ok && bytes.Equal(v, root[key]) {
				inherited = append(inherited, key)
				delete(t, key)
			}
		}
		if len(inherited) > 0 {
			t["inherit"], _ = json.Marshal(inherited)
		}
	}
	root["targets"], err = json.Marshal(targets)
	if err != nil {
		return nil, err
	}
	return json.Marshal(root)
}

func (b *ContextBundle) UnmarshalJSON(raw []byte) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		return err
	}
	if bytes.Equal(root["compactTargets"], []byte("true")) && root["targets"] != nil {
		var targets []map[string]json.RawMessage
		if err := json.Unmarshal(root["targets"], &targets); err != nil {
			return err
		}
		for _, t := range targets {
			var inherited []string
			if v := t["inherit"]; v != nil {
				if err := json.Unmarshal(v, &inherited); err != nil {
					return err
				}
			}
			for _, key := range inherited {
				allowed := false
				for _, field := range sharedContextFields {
					if field == key {
						allowed = true
						break
					}
				}
				if !allowed || root[key] == nil || t[key] != nil {
					return fmt.Errorf("invalid shared chapter context field %q", key)
				}
				t[key] = root[key]
			}
			delete(t, "inherit")
		}
		var err error
		root["targets"], err = json.Marshal(targets)
		if err != nil {
			return err
		}
		raw, err = json.Marshal(root)
		if err != nil {
			return err
		}
	}
	var out contextWire
	if err := json.Unmarshal(raw, &out); err != nil {
		return err
	}
	*b = ContextBundle(out)
	return nil
}
