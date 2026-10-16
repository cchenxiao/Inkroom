package planning

import "testing"

func TestInputAndDirectionValidation(t *testing.T) {
	if err := (Intake{Premise: "   "}).Validate(); err == nil {
		t.Fatal("blank premise accepted")
	}
	if err := (Intake{Premise: "一个修钟人收到来自明天的返修单。"}).Validate(); err != nil {
		t.Fatal(err)
	}
	if err := (Direction{Title: "标题"}).Validate(); err == nil {
		t.Fatal("incomplete direction accepted")
	}
	if err := (Intake{Premise: "一个故事", Packs: []PackRef{{ID: "unknown", Version: 1}}}).Validate(); err == nil {
		t.Fatal("unknown pack accepted")
	}
}
