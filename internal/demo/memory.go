package demo

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"inkloom/internal/domain/memory"
)

//go:embed memory.json
var memorySeed []byte

// MemoryPreview 是独立教学数据，不是已定稿的正式故事；不会写入数据库或 Writer。
// 后续由仓储读取指定 commit 的材料和可见性元数据，替换这里的固定记录。
func MemoryPreview(pov string) (memory.View, []memory.Record, error) {
	if pov != "character-shenyan" && pov != "character-luqing" {
		return memory.View{}, nil, fmt.Errorf("preview POV must be character-shenyan or character-luqing")
	}
	var records []memory.Record
	if err := json.Unmarshal(memorySeed, &records); err != nil {
		return memory.View{}, nil, err
	}
	v := memory.View{ProjectID: "zhuoliu", BranchID: "main", POV: pov, At: memory.Moment{Chapter: 7, StoryTime: 420}, Pins: map[string]memory.Pin{}}
	for _, r := range records {
		// 教学中此集合充当已确认的版本目录。真实实现须从固定的版本清单读取，
		// 不能用刚搜到的候选内容同时生成 Pin，否则摘要检查形同虚设。
		if r.Status == memory.Confirmed && r.ProjectID == v.ProjectID && r.BranchID == v.BranchID {
			v.Pins[r.ID] = memory.Pin{Version: r.Version, Digest: memory.Digest(r)}
		}
	}
	for i := range records {
		if records[i].ID == "seed-outdated" {
			// 模拟索引尚未更新：固定目录指向 v2，而搜索返回 v1，必须被挡住。
			records[i].Version = 1
			records[i].Text = "旧版写法：旧闸的锁已经断了。"
		}
	}
	return v, records, nil
}

// MemorySeed 返回原始教学目录，供明确执行的数据库演示初始化使用。
func MemorySeed() ([]memory.Record, error) {
	var records []memory.Record
	err := json.Unmarshal(memorySeed, &records)
	return records, err
}
