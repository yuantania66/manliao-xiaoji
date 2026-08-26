# Hill Helping Batch 0 Human Blind Review Result

状态：人工盲审完成并揭盲；当前批次 0 运行结果未通过适用质量门

日期：2026-07-31

## 1. Freeze and Unblinding Integrity

- reviewer: `user-human-review`;
- 12/12 组在读取密钥前完成；
- 冻结裁决文件 SHA-256：
  `5454a9c8a61840af7d9995e836bced04935f19c8216273c0fba5a74c4e64c0e6`；
- 提交的密钥承诺：
  `32fb60b120f93b916a47c011e5abbd7655bdb67aaca7509c5c37b0512a030e47`；
- 密钥文件实际 SHA-256 与承诺完全一致；
- 冻结后才读取逐组 X/Y 映射；
- 人工评分、偏好、严重问题和备注没有修改。

揭盲身份：

- baseline：`A-repo`，source
  `3e34257c392cce79afbd12bfe36a5fbdbe84ab6c`；
- candidate：`H0`，source `hill-batch0-current-runtime`；
- 两侧均为 qwen / `qwen3.7-max`，同一 Gate v0 数据集，各运行 3 次。

原始机器汇总见
[human blind result JSON](./hill-helping-batch0-human-blind-result-20260731.json)，
冻结人工答案见
[human blind adjudication](./hill-helping-batch0-human-blind-adjudication-20260731.json)。

## 2. Overall Result

| Human judgment | Current H0 | Reproducible baseline |
| --- | ---: | ---: |
| absolute pass | 6/12 | 9/12 |
| appropriate conversation outcome | 6/12 | 10/12 |
| would continue | 6/12 | 9/12 |
| preferred side | 3/12 | 6/12 |
| clearly worse side | 4/12 | 2/12 |
| critical failures | 0 | 0 |
| ties | 3 paired reviews | 3 paired reviews |

Current H0 failed every applicable quality threshold except the zero-critical-
failure gate:

- each episode has at least 2/3 absolute passes: failed;
- total absolute passes at least 10/12: failed at 6/12;
- appropriate outcomes at least 10/12: failed at 6/12;
- clearly worse than baseline at most 1/12: failed at 4/12;
- every target episode prefers candidate in at least 2/3 runs: failed.

## 3. Result by Conversation Type

| Conversation type | Current absolute pass | Baseline absolute pass | Current preferred | Baseline preferred | Tie |
| --- | ---: | ---: | ---: | ---: | ---: |
| numeric multi-turn | 0/3 | 3/3 | 0/3 | 3/3 | 0 |
| emotional statement | 3/3 | 1/3 | 2/3 | 0/3 | 1 |
| evidence-limited repair | 3/3 | 2/3 | 1/3 | 0/3 | 2 |
| numeric single-turn | 0/3 | 3/3 | 0/3 | 3/3 | 0 |

Observation:

- current H0 improved the emotional-statement cases in this sample;
- current H0 was also accepted in all three evidence-limited repair cases;
- all six current numeric episode runs failed absolute pass, appropriate
  outcome and willingness-to-continue judgments;
- four of those numeric runs were judged clearly worse than the baseline;
- no critical failure code was selected on either side.

## 4. Reviewer Note Preserved

The only free-text reviewer note is preserved verbatim in the adjudication
file. Its substantive point is:

- `我没法完全体会你的感受` can communicate that, regardless of what the user
  says, the Assistant cannot understand them;
- the compared current reply was judged better, but the missing preceding
  context made the repair case difficult to evaluate confidently.

This note cannot be generalized into a wording rule. It is evidence for the
approved relationship-repair and complete-context trajectory requirements.

## 5. Interpretation

The evidence does not say the whole current system is uniformly worse. It shows
a split result:

- emotional response and limited repair improved in these repeated samples;
- low-information conversation movement regressed sharply into repeated
  receipt-style acknowledgement.

The primary failure is therefore not one undesirable sentence. Current H0 can
produce acceptable supportive language, but it does not maintain a reliable
process for deciding what should happen next when the user's meaning is still
unclear.

This result strengthens the Batch 0 migration baseline. It does not invalidate
Batch 0's documentation-and-baseline acceptance, and it does not authorize a
user-visible Hill release.

## 6. Evidence Limitations

- four independent captured situations only;
- three repeated runs per situation;
- no verified production baseline;
- no held-out real episode;
- no non-target real episode;
- repair episode lacks the preceding misunderstanding context;
- the result cannot establish overall production quality.

## Completed

Human answers were frozen, commitment-verified, unblinded and summarized
without changing any rating.

## Evidence

The frozen adjudication, committed key, raw A/B artifacts and generated result
JSON agree on all 12 mappings and totals.

## Remaining

Current chat quality remains below the frozen user-visible gate. Hill Shadow,
complete repair trajectories, held-out data and non-target evidence remain
unimplemented.

## Blocking Reason

无。The blind-review computation completed; the quality result itself is a
verified failure, not a tooling blocker.

## Recommended Next Step

Use this frozen human review as a Batch 1 regression baseline, especially the
0/6 current numeric result; do not repair those six outputs with sentence-level
special cases.
