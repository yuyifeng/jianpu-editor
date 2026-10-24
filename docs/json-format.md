# 简谱 JSON 文件格式说明

简谱工坊导出的 JSON 文件包含文件格式信息和一首歌曲的完整可编辑数据，可用于备份、分享和再次导入。

## 完整示例

```json
{
  "format": "jianpu-editor",
  "version": 1,
  "score": {
    "id": "score-example",
    "title": "示例歌曲",
    "keySignature": "C",
    "mode": "major",
    "timeSignature": "4/4",
    "tempo": 90,
    "measures": [
      {
        "id": "measure-1",
        "symbols": [
          {
            "id": "note-1",
            "kind": "note",
            "degree": 1,
            "duration": "quarter",
            "octave": 0,
            "accidental": "none",
            "dotted": false,
            "extension": 0,
            "tieToNext": false
          },
          {
            "id": "rest-1",
            "kind": "rest",
            "duration": "quarter",
            "dotted": false,
            "extension": 0
          }
        ],
        "chords": [
          {
            "id": "chord-1",
            "measureId": "measure-1",
            "degree": 1,
            "position": 0
          }
        ]
      }
    ]
  }
}
```

## 顶层字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `format` | 字符串 | 文件类型标识，固定为 `"jianpu-editor"`。 |
| `version` | 整数 | 文件格式版本，当前固定为 `1`。 |
| `score` | 对象 | 歌曲的完整数据。 |

导入时，`format` 或 `version` 不匹配会被判定为不支持的文件。

## `score` 歌曲字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | 字符串 | 歌曲唯一标识。 |
| `title` | 字符串 | 歌曲标题。 |
| `keySignature` | 字符串 | 调号。 |
| `mode` | 字符串 | 调式。 |
| `timeSignature` | 字符串 | 拍号。 |
| `tempo` | 整数 | 速度，单位为 BPM，允许范围为 `30` 到 `240`。 |
| `measures` | 数组 | 小节列表，至少包含一个小节。 |

### 调号 `keySignature`

允许值：

```text
C, C#/Db, D, D#/Eb, E, F, F#/Gb, G, G#/Ab, A, A#/Bb, B
```

### 调式 `mode`

| 值 | 含义 |
| --- | --- |
| `major` | 大调 |
| `natural-minor` | 自然小调 |

### 拍号 `timeSignature`

| 值 | 每小节容量 |
| --- | --- |
| `2/4` | 8 个十六分音符单位 |
| `3/4` | 12 个十六分音符单位 |
| `4/4` | 16 个十六分音符单位 |
| `6/8` | 12 个十六分音符单位 |

## 小节字段

`score.measures` 中的每个元素表示一个小节。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | 字符串 | 小节唯一标识。 |
| `symbols` | 数组 | 按顺序排列的音符和休止符。 |
| `chords` | 数组 | 小节中的和弦级数标记。 |

允许小节时值不足或超出拍号容量，编辑器会在界面中显示相应状态。

## 音符和休止符公共字段

`symbols` 中的元素通过 `kind` 区分音符和休止符。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | 字符串 | 元素唯一标识。 |
| `kind` | 字符串 | `"note"` 表示音符，`"rest"` 表示休止符。 |
| `duration` | 字符串 | 基础时值。 |
| `dotted` | 布尔值 | 是否附点。`true` 表示基础时值乘以 `1.5`。 |
| `extension` | 整数 | 额外延长的十六分音符单位数，范围为 `0` 到 `4`。 |

### 时值 `duration`

| 值 | 含义 | 十六分音符单位 |
| --- | --- | ---: |
| `whole` | 全音符 | 16 |
| `half` | 二分音符 | 8 |
| `quarter` | 四分音符 | 4 |
| `eighth` | 八分音符 | 2 |
| `eighth-triplet` | 八分三连音中的一个音 | 4/3 |
| `sixteenth` | 十六分音符 | 1 |

三个 `eighth-triplet` 音符合计为 4 个单位，即一个四分音符。

### 最终时值计算

```text
最终时值 = 基础时值 ×（dotted 为 true 时取 1.5，否则取 1）+ extension
```

例如，四分音符、附点、额外延长 `1` 个单位的最终时值为：

```text
4 × 1.5 + 1 = 7
```

## 音符专有字段

当 `kind` 为 `"note"` 时，还包含以下字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `degree` | 整数 | 简谱音级，范围为 `1` 到 `7`。 |
| `octave` | 整数 | 八度偏移，范围为 `-2` 到 `2`；`0` 表示中央八度。 |
| `accidental` | 字符串 | 临时升降记号。 |
| `tieToNext` | 布尔值 | 是否通过延音线连接后一个相同音高的音符。 |

### 临时记号 `accidental`

| 值 | 含义 |
| --- | --- |
| `none` | 无临时记号 |
| `sharp` | 升号 |
| `flat` | 降号 |
| `natural` | 还原号 |

### 八度 `octave`

| 值 | 含义 |
| ---: | --- |
| `2` | 高两个八度 |
| `1` | 高一个八度 |
| `0` | 中央八度 |
| `-1` | 低一个八度 |
| `-2` | 低两个八度 |

休止符不包含 `degree`、`octave`、`accidental` 和 `tieToNext`。

## 和弦字段

`chords` 中的每个元素表示一个和弦级数事件。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | 字符串 | 和弦事件唯一标识。 |
| `measureId` | 字符串 | 所属小节 ID，必须与外层小节的 `id` 一致。 |
| `degree` | 整数 | 和弦级数，范围为 `1` 到 `7`。 |
| `position` | 整数 | 在小节中的起始位置，从 `0` 开始，以十六分音符为单位。 |

例如，在 `4/4` 拍中：

| `position` | 位置 |
| ---: | --- |
| `0` | 第一拍开始 |
| `4` | 第二拍开始 |
| `8` | 第三拍开始 |
| `12` | 第四拍开始 |

同一小节的同一 `position` 不能包含多个和弦事件。

## ID 规则

- `score`、小节、音符、休止符和和弦事件的 `id` 都不能为空。
- 同一份文件内的所有 `id` 必须唯一。
- `id` 由编辑器生成，用于关联和编辑对象，不承载乐理含义。
- 手动修改 JSON 时，建议保留现有 `id`；新增对象时必须生成不重复的值。

## 导入限制

导入文件必须满足以下条件：

- JSON 语法正确。
- `format` 必须为 `"jianpu-editor"`。
- `version` 必须为 `1`。
- `tempo` 必须是 `30` 到 `240` 之间的整数。
- 至少包含一个小节。
- 枚举字段必须使用本文列出的允许值。
- 所有实体 ID 必须唯一。
- 和弦的 `measureId` 必须匹配所属小节。
- 和弦的 `position` 必须是小节范围内的整数位置。

