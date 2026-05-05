# 歌单导入功能设计方案

## 一、功能概述

在管理页面（Admin.tsx）添加一键导入主流音乐平台歌单的功能，支持：
- **导入为备用歌单**：解析歌单后保存为备用歌单，队列为空时自动播放
- **直接加入队列**：解析歌单后批量加入当前点歌队列

## 二、支持平台

| 平台 | 歌单链接格式 | Meting server 参数 |
|------|-------------|-------------------|
| 网易云音乐 | `https://music.163.com/playlist?id=123456` | `netease` |
| QQ音乐 | `https://y.qq.com/n/ryqq/playlist/001xxxxxx` | `tencent` |
| 酷狗音乐 | `https://www.kugou.com/songlist/gcid_3zk5pusxz6z019/` | `kugou` |
| 酷我音乐 | `https://www.kuwo.cn/playlist/list/2895989165` | `kuwo` |
| 咪咕音乐 | `https://music.migu.cn/v3/music/playlist/66666666` | `migu` |
| 纯数字ID | 默认为网易云 | `netease` |

## 三、技术架构

```
用户粘贴歌单链接
        |
   URL格式识别（正则匹配）
        |
   提取平台 + 歌单ID
        |
   Meting API 解析歌单
   (api.injahow.cn/meting)
        |
   返回歌曲列表 [{name, artist, album, pic}]
        |
   标准化为 Song[] 格式
        |
   +----+----+
   |         |
   |         |
导入为备用歌单  直接加入队列
```

## 四、API设计

### 1. 后端新增路由

**文件**: `packages/server/src/routes/admin.ts`

```typescript
// POST /admin/import-playlist
// Body: { url: string, mode: 'fallback' | 'queue', userId?: string, userName?: string }
// Response: { playlist?: FallbackPlaylist, count?: number } 或 { queueItems: QueueItem[] }

router.post('/import-playlist', checkAdmin, async (req, res) => {
  // 1. 解析URL，提取平台和ID
  // 2. 调用Meting API获取歌单内容
  // 3. 标准化为Song[]格式
  // 4. 根据mode：
  //    - fallback: 创建备用歌单
  //    - queue: 批量加入队列
  // 5. 广播更新
});
```

### 2. 音乐服务新增函数

**文件**: `packages/server/src/services/music.ts`

```typescript
// 解析歌单URL
function parsePlaylistUrl(input: string): { platform: string; id: string } | null

// 获取歌单内容
async function fetchPlaylist(platform: string, id: string): Promise<Song[]>
```

## 五、前端UI设计

### 位置：Admin.tsx → 备用列表Tab

**新增组件**：歌单导入对话框

```
+------------------------------------------+
| 歌单导入                                 |
+------------------------------------------+
| 请输入歌单链接：                          |
| [________________________________]       |
|                                          |
| 示例：                                   |
| - 网易云：https://music.163.com/playlist?id=123456 |
| - QQ音乐：https://y.qq.com/n/ryqq/playlist/001xxxxxx |
| - 酷狗：https://www.kugou.com/songlist/gcid_xxx |
| - 酷我：https://www.kuwo.cn/playlist/list/123456 |
| - 纯数字ID：默认网易云                     |
|                                          |
| 导入方式：                               |
| ○ 保存为备用歌单                          |
| ○ 直接加入队列                           |
|                                          |
| [取消]  [开始导入]                        |
+------------------------------------------+
```

## 六、数据流

### 导入为备用歌单
```
用户点击"开始导入"
  → POST /admin/import-playlist { url, mode: 'fallback' }
  → 后端解析URL → 调用Meting API → 获取歌曲列表
  → 创建备用歌单 (name: "导入歌单 (网易云)")
  → 广播 fallback_update
  → 前端刷新备用歌单列表
```

### 直接加入队列
```
用户点击"开始导入"
  → POST /admin/import-playlist { url, mode: 'queue', userId: 'admin-import', userName: '管理员导入' }
  → 后端解析URL → 调用Meting API → 获取歌曲列表
  → 批量调用 addToQueue()
  → 广播 queue_update
  → 前端刷新队列列表
```

## 七、错误处理

| 错误场景 | 错误信息 |
|---------|---------|
| 无法识别链接格式 | "无法识别歌单链接，请输入正确的音乐平台歌单链接" |
| 歌单为空 | "歌单内容为空或解析失败" |
| 网络请求失败 | "获取歌单失败，请稍后重试" |
| 歌单歌曲过多（>200） | "歌单歌曲过多，仅导入前200首" |

## 八、实施步骤

### 第一步：后端服务层 (music.ts)
1. 新增 `parsePlaylistUrl()` 函数
2. 新增 `fetchPlaylist()` 函数
3. 新增 `METING_API_BASE` 常量

### 第二步：后端路由层 (admin.ts)
1. 新增 `POST /admin/import-playlist` 路由
2. 实现歌单解析和导入逻辑

### 第三步：前端API层 (api.ts)
1. 新增 `importPlaylist()` 函数

### 第四步：前端UI层 (Admin.tsx)
1. 新增歌单导入对话框组件
2. 在备用列表Tab添加"从链接导入"按钮
3. 实现导入逻辑和状态管理

### 第五步：测试验证
1. 测试各平台歌单链接解析
2. 测试两种导入模式
3. 测试错误处理
4. 测试边界情况（空歌单、超长歌单）

## 九、注意事项

1. **Meting API稳定性**：公开实例可能不稳定，需要多实例fallback
2. **歌单大小限制**：建议限制导入歌曲数量（如200首）
3. **CDN资源**：导入的歌曲可能没有CDN播放链接，但搜索API有
4. **平台差异**：不同平台的歌曲ID和source不同，需要注意映射
5. **管理员权限**：此功能仅管理员可用，需要密码验证

## 十、后续扩展

1. 支持从本地文件导入（如TXT、CSV格式的歌单）
2. 支持从其他平台导入（如Spotify、Apple Music）
3. 支持歌单更新同步
4. 支持歌单预览和编辑
