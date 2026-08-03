# Conversation Grounding Leak — PRE A/B

Generated: 2026-07-23T08:07:01.286Z
Provider/model: qwen/DashScope qwen3.7-max
Synthetic user turns: 8/8
External calls including interpretation: 14

## A_new_conversation

- Prompt hash: 715d22ac6b2e681bcab0437110b2571b0c626c6cf9d743b2c4bad6868a93393f
- Plan hash: 42d50a9a94a361532785f0559cbcd213464484cb912d0cc1548c4a836386cb3c
- Dialogue act: yield_initiative
- Required disclosure: []
- Raw: 最近有看什么剧或者电影吗？
- Validator: [{"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-a:1784794003479:5","planChanged":false}]
- Final: 最近有看什么剧或者电影吗？
- raw===final: true

## B_answered_body_then_no_topic

- Prompt hash: 21fccc2e9a634dfbfa2bc902dd03acc9150021e37a81b0ef76689346d126897f
- Plan hash: f00cfaa29a6456f1bb69a444d1cf45242fdbb21227586422a56d6ff2d091d4e4
- Dialogue act: yield_initiative
- Required disclosure: []
- Raw: 今天有看什么剧或者综艺吗？
- Validator: [{"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-b:1784794007156:5","planChanged":false}]
- Final: 今天有看什么剧或者综艺吗？
- raw===final: true

## C_answered_identity_then_no_topic

- Prompt hash: 3115f0cddcb15436c2fa7ebd7ab6e54560407295ec0f8528a2c0d4bc0eb5a6e4
- Plan hash: ca6d95430571c4bf68f96ae2f3253a50f5fb4083e594819426b11624480cce78
- Dialogue act: yield_initiative
- Required disclosure: []
- Raw: 最近有看什么剧或者电影吗？
- Validator: [{"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-c:1784794010524:5","planChanged":false}]
- Final: 最近有看什么剧或者电影吗？
- raw===final: true

## D1_resumed_no_topic

- Prompt hash: 2dbbcffe6913d79307df57ca6fa2ac82c2faafcc3d2d3d4d6a26aa505ca296ab
- Plan hash: e8be345b4990c2ce8d1853a515e714cdc21acf71a59c5eece05c531190addfda
- Dialogue act: yield_initiative
- Required disclosure: []
- Raw: 最近有看什么剧或者电影吗？
- Validator: [{"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-d:1784794014025:5","planChanged":false}]
- Final: 最近有看什么剧或者电影吗？
- raw===final: true

## D2_first_correction

- Prompt hash: 5e3248485c6ca54321069da99a42c60bdabce2668886a6b4a6e01c7c4a2dad67
- Plan hash: 58e38931f4474a13fec87e7fb5806c3bbd8892960dc3551e55ab274c435ec575
- Dialogue act: ask_capability
- Required disclosure: ["助手没有真实身体，不能字面执行当前被询问的身体动作。"]
- Raw: 抱歉，是我理解错了。我没有真实身体，确实不能真的坐下。
- Validator: [{"passed":false,"failureReasons":["question_not_allowed_by_plan"],"checkedPlanId":"synthetic-grounding-pre-d:1784794014737:7","planChanged":false},{"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-d:1784794014737:7","planChanged":false}]
- Final: 抱歉，是我理解错了。我没有真实身体，确实不能真的坐下。
- raw===final: true

## D3_second_correction

- Prompt hash: ab2ca453618c9155f1addd07722d93d748fba418f80443953d9b1fc82da314c7
- Plan hash: d0b0c35f90944c3cb65559a4278648f400808fa24781a66ee576f612932adac2
- Dialogue act: correct_assistant
- Required disclosure: []
- Raw: 是我多说了，刚才确实没对上你的话。
- Validator: [{"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-d:1784794018968:7","planChanged":false}]
- Final: 是我多说了，刚才确实没对上你的话。
- raw===final: true

## ABLATION_C_minimal_surface_same_plan

- Prompt hash: 4105f106da44545f1d88a75acd372aed2820f52a1c4b4c76f639e72b211910e9
- Plan hash: e8be345b4990c2ce8d1853a515e714cdc21acf71a59c5eece05c531190addfda
- Dialogue act: same as D1
- Required disclosure: same as D1
- Raw: 今天午饭吃了什么？
- Validator: {"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-d:1784794014025:5","planChanged":false}
- Final: 今天午饭吃了什么？
- raw===final: true

## ABLATION_D_remove_available_facts_same_plan

- Prompt hash: 21065c74403859dc138b260fc326f94d08657e0c4dde2fee6194ae12565bad8f
- Plan hash: e8be345b4990c2ce8d1853a515e714cdc21acf71a59c5eece05c531190addfda
- Dialogue act: same as D1
- Required disclosure: same as D1
- Raw: 最近有看什么剧或者电影吗？
- Validator: {"passed":true,"failureReasons":[],"checkedPlanId":"synthetic-grounding-pre-d:1784794014025:5","planChanged":false}
- Final: 最近有看什么剧或者电影吗？
- raw===final: true
