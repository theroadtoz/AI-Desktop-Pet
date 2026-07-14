# Take Contract

Schema version: `live2d-take-contract/v1`.

在 arm 阶段生成不可变 contract，并把完整摘要显示在当前界面。contract 只记录安全摘要，绝不包含 token、绝对路径、摄像头/音频/画面或原始脸部数据。

## 必填字段

| 字段 | 要求 |
| --- | --- |
| `take_id` | 本次唯一 ID；旧 ID 不可复用。 |
| `profile` | `id`、`revision`、`digest`、`status=ready`。 |
| `template` | 冻结后的 templateKind。 |
| `connection` | 实测的 protocol、host、port、tool 配置来源与 VTS 实际值；port 不写死。 |
| `token_ref` | 仅 `main + safeStorage` 的引用/可用性结果；不得含 token 值。 |
| `model_identity` | CurrentModel 的安全身份、模型参数签名或等价受信标识。 |
| `capabilities` | API state、鉴权、CurrentModel、Live2DParameterList 与允许参数存在性的快照。 |
| `allowlist` | 从 profile 冻结的精确参数 ID 集合。 |
| `capture_duration` | 实际采集时长。 |
| `motion_duration` | 预期 Motion3 Meta.Duration。 |
| `cycle_duration` | loop 的周期语义；one-shot/enter/exit 必须明确为不适用。 |
| `outputPrefix` | profile 派生的相对受管前缀；不得为绝对路径。 |
| `ownership` | 本 take 可创建、可停止、可删除的资源 ledger。 |
| `created_at` / `expires_at` | armed 时间和失效时间。 |

## 确认与失效

1. 只在界面显示当前 `take_id` 和短摘要后接受用户完全一致的 `准备好了`。
2. 确认上限为 10 分钟或 recorder 工具 TTL，以更短者为准。
3. profile revision/digest、template、connection、token 可用性、模型身份、能力快照、allowlist、任一时长、outputPrefix 或 ownership 变化时，立即让 armed contract 和确认失效。
4. 失效后必须重新 arm、重新显示新 take ID，并重新等待当前 take 的 `准备好了`；旧确认、连接成功和鉴权成功均不可复用。

## Ownership Ledger

在创建资源前追加 `kind`、受控标识、创建时间和 owner=`take_id`；仅清理该 ledger 中仍由本流程拥有的资源。每个清理结果记录 `removed`、`retained-user-owned`、`not-found` 或 `failed`，并给出原因。保留被明确批准保存的 draft。
