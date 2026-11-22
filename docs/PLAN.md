# Local AI Studio — актуальная архитектура, статус и план

Обновлено: 2026-11-22. Документ описывает **реальное состояние кодовой базы**
(`backend/`, `frontend/src/`), а не первоначальный MVP-замысел.

---

## 1. Назначение

Локальный рабочий стол, полностью совместимый с форматом Google AI Studio (GAS):
приложение читает и **редактирует на месте** JSON-чаты из папки
`C:\Users\Nekromant\Documents\Google AI Studio` (переопределяется переменной
`GAS_CHAT_DIR`), а генерацию выполняет через любой **OpenAI-совместимый
локальный API** (LM Studio, Ollama, llama.cpp, Strata и т. п.).

## 2. Запуск

| Компонент | Команда | Адрес |
|---|---|---|
| Backend | `backend\.venv\Scripts\python.exe run.py` (из `backend/`) | `http://127.0.0.1:8000` |
| Frontend (прод-сборка) | `cd frontend && ..\.tools\node\npm.cmd run build` | отдаётся FastAPI из `frontend/dist` |
| Frontend (dev) | `..\.tools\node\npm.cmd run dev` | `http://localhost:5173` (proxy на 8000 в `vite.config.ts`) |

Node.js портативный — в `.tools\node` (для `npm.cmd` нужен `node` в `PATH`).
Env-переменные: `LOCAL_AI_STUDIO_HOST/PORT/RELOAD`, `GAS_CHAT_DIR`,
`LOCAL_AI_STUDIO_DATA`. Swagger: `/api/docs`.

## 3. Структура и модули

### Backend (`backend/`, FastAPI + httpx + Pillow + tiktoken)

| Модуль | Ответственность |
|---|---|
| `app/main.py` | приложение, lifespan (очистка uploads/thumbnails по сроку), CORS, обработчики ошибок, статика `frontend/dist`, корневой `/health` |
| `app/config.py` | пути (`CHAT_DIR`, `DATA_DIR`, uploads/backups/thumbnails, `settings.json`), `DEFAULT_SETTINGS`, `DEFAULT_CHAT_RUN_SETTINGS` (в т. ч. `thinkingLevel`), константы уровней мышления (`THINKING_LEVELS`, маппинги в `reasoning_effort` и GAS `thinkingLevel`, `normalize_thinking_level`), атомарное сохранение настроек |
| `app/gas_store.py` | индекс папки GAS (mtime-кэш), `get_document/create_chat/save_document/rename_chat/delete_chat` (в `data/trash`), бэкапы перед записью, `estimate_chat_tokens`, `default_chat` |
| `app/attachments.py` | разбор `driveImage/inlineImage/driveDocument/youtubeVideo/...`, санитизация чата перед отправкой в браузер (inline base64 → lazy-endpoint), «обезвреживание» и реконструкция (`rehydrate_chat`) при сохранении, привязка Drive-объектов к локальным файлам, Temp-файлы загрузок |
| `app/llm.py` | OpenAI-совместимый стриминг: `list_models`, `build_messages` (чаты GAS → messages с картинками/файлами + depth-prompting блок `<system_reminder>`), `ThinkTagFilter` (перехват `<think>` в reasoning-канал), поддержка `reasoning_content`, `reasoning_effort` по уровню мышления, подготовка усечения контекста, генерация GAS-чанков ответа (`make_generated_chunks`, `thinkingBudget: -1`) |
| `app/tokens.py` | tiktoken с кэшем и graceful fallback на эвристику |
| `app/utils.py` | атомарная запись JSON, валидация имён, id/имена файлов чатов |
| `app/routers/system.py` | `/api/health`, `/api/settings` GET/PUT (валидация baseUrl/ключей/лимитов), `/api/tokens/count` |
| `app/routers/chats.py` | CRUD чатов + `POST /api/chats/{id}/generate` (SSE: `token`, `reasoning_delta`, `done`, `error`, heartbeat), `GET /api/chats/{id}/assets/{chunk}/{slot}` |
| `app/routers/assets.py` | `POST /api/assets/upload`, `GET /api/uploads/{id}`, `GET /api/assets/local` (скан папки GAS), `/api/assets/local/file`, `/api/assets/local/thumb` (Pillow) |
| `app/routers/llm.py` | `GET /api/llm/models` (по baseUrl/apiKey), `GET /api/llm/presets` (легаси — фронтенд пресеты не читает, они захардкожены в `RightPanel.tsx`) |
| `data/` | `settings.json` (глобальные настройки + API-ключ), `backups/`, `uploads/`, `thumbnails/`, `trash/` |

### Frontend (`frontend/src/`, React 18 + Vite + TS + Tailwind + Zustand)

| Модуль | Ответственность |
|---|---|
| `App.tsx` | каркас: Sidebar / ChatHeader / ChatWorkspace / Composer / RightPanel, мобильные оверлеи, тосты ошибок/уведомлений, хоткеи (`Ctrl+B`, `Esc`) |
| `store/useAppStore.ts` | единый Zustand-store: чаты, документ, оптимистичные правки через `updateChat` + debounce-сохранение, SSE-генерация, настройки (`useLocalSettings` = слияние глобальных и `runSettings.localApi` чата), `setSystemInstruction`, загрузка моделей |
| `lib/api.ts`, `lib/frames.ts` | клиент API; разбор GAS-чанков в «фреймы» (сообщения, мысли, вложения, code execution, grounding) |
| `components/` | `Sidebar` (поиск/создание/переименование/удаление), `ChatWorkspace` + `MessageFrame` + `StreamingMessage` + `ThinkingBlock` (тайминг размышлений), `Composer` (pendingInputs, стоп-генерация), `AttachmentPicker/Grid` (выбор слотов image/file, локальные файлы, превью), `PreviewModal`, `RightPanel`, `CodeBlock`, `MarkdownView`, `Modal`, `ConfirmDialog`, `CopyButton`, `EmptyState` |
| `RightPanel.tsx` | панель «Контекст и модель»: статистика токенов с прогресс-баром; System Instructions (инлайн + модалка, см. §5); «Локальный API» — Base URL + пресеты **Strata / LM Studio / Ollama / llama.cpp** (Strata: ключ `strata-local` + автообновление списка с автовыбором модели), модель — dropdown из `/api/llm/models` с режимом ручного ввода, API Key (глобально); параметры генерации — Thinking Level (`Off / Low / Medium / High / Extra High`), Temperature/Max Output (блокируются при мышлении), Top P, Context Window, отправка вложений |

## 4. Формат GAS (что реально встречается в чатах)

`runSettings` (в т. ч. `thinkingLevel: THINKING_HIGH`, `model: models/gemini-*`),
`systemInstruction.text`, `chunkedPrompt.chunks[]` с ролями `user`/`model`,
`isThought`+`parts[].thought` (мысли), `tokenCount`, `createTime`,
`finishReason`, вложения `driveImage` (только Drive-ID), `inlineImage/inlineFile`
(base64), `youtubeVideo`, `driveDocument`, плюс наследие GAS:
`executableCode`, `codeExecutionResult`, `grounding`, `citations`,
`toolCall/toolResponse`, `errorMessage`.
Наши правки пишутся в тот же JSON атомарно, с бэкапом в `data/backups` перед каждой записью;
удаление — перенос в `data/trash`. При отдаче чата браузеру inline-base64 выносится
в lazy-эндпоинт `assets`, при сохранении — реконструируется.

## 5. Уже реализовано

**Данные и чаты**
- Индексация ~115 GAS-чатов с кэшем, поиск, создание/переименование/удаление (в корзину), бэкапы.
- Полноценный редактор чата: pendingInputs-композер, правка/удаление/повтор фреймов, regenerate.
- Фреймы: текст + markdown + подсветка кода, мысли (складка + время размышления), картинки/файлы, code execution, grounding/citations.

**Генерация**
- SSE-стриминг из OpenAI-совместимого API, ответ дописывается в GAS-чанки (включая thought-чанки с `thinkingBudget: -1`).
- Thinking Level: для всех уровней кроме `Off` — без `temperature`, `max_tokens=65536`, в запрос передаётся `reasoning_effort` (`none/low/medium/high`); перехват `<think>`-тегов и поля `reasoning_content`.
- Depth Prompting: при заданной `systemInstruction.text` или уровнях `High/Extra High` перед последним пользовательским сообщением (только в памяти запроса, JSON чата на диске не меняется) вставляется блок `<system_reminder>` с ключевыми правилами системной инструкции, а для `High/Extra High` — с требованием 3–4 альтернативных сценариев, подводных камней и запасного плана (`Extra High` — максимально глубокий пошаговый разбор).
- Учёт токенов (tiktoken/fallback), проверка окна контекста, подготовка усечения, лимит 12 изображений на запрос; мысли не отправляются в контекст модели.

**Вложения**
- Загрузка своих файлов (temp → чат), превью, миниатюры (Pillow), показ Drive-объектов карточками с ссылкой на Drive, привязка Drive-ID к локальным файлам папки GAS (в т. ч. авто-совпадение по SHA-256), скан локальных файлов.

**Настройки**
- Глобальные (`data/settings.json`) + per-chat `runSettings.localApi`; API-ключ хранится только глобально.
- Список моделей по Base URL с обновлением; статус доступности API.
- **Задача №2 выполнена (2026-11-22)**:
  - **Thinking Level** в правой панели: компактный селектор `Off / Low / Medium / High / Extra High` (по умолчанию `High`) вместо тумблера Reasoning Mode; уровень хранится в `runSettings.localApi.thinkingLevel` + дублируется в GAS-поле `runSettings.thinkingLevel` (`THINKING_NONE/LOW/HIGH`); обратная совместимость со старыми чатами (цепочка: `localApi.thinkingLevel` → legacy `reasoningMode` → GAS `thinkingLevel` → глобальная настройка). При любом уровне кроме `Off` Temperature скрыт/не отправляется, `Max Output Tokens = 65536`, бэкенд передаёт `reasoning_effort`.
  - **Depth Prompting** (см. «Генерация»): защита от затухания системного промпта через `<system_reminder>`.
  - **Модель** — полноценный dropdown из `/api/llm/models` (с опцией ручного ввода ID).
  - **Пресет Strata**: Base URL `http://localhost:47831/v1`; при пустом API KEY автоматически сохраняется `strata-local`, затем немедленное обновление списка моделей с автовыбором первой доступной (например `iq3_s`), если текущей модели в новом списке нет.
  - **UI**: нижняя панель ввода («Спросите модель…») скрывается, когда открыто полноэкранное окно «История чатов».
- **Модалка System Instructions** — кнопка-иконка `Maximize2` в заголовке секции; широкое модальное окно (~70% высоты экрана, тёмная тема, через общий `Modal`), крупный textarea, счётчик символов в футере, синхронное автосохранение в `chat.systemInstruction.text` (debounce 500 мс + немедленный flush при закрытии); закрытие — «Готово», крестик, Esc, клик по фону (2026-11-22).

**UX**
- Тёмная тема, glass-панели, адаптив (мобильные оверлеи панелей ≥1280px desktop), тосты, confirm-диалоги, копирование сообщений, автоскролл, stop-generation.

## 6. Известные особенности / техдолг

- `GET /api/llm/presets` на бэкенде устарел: фронтенд держит свой список в `RightPanel.tsx` (единый источник стоит перенести на бэкенд или удалить роут).
- Мысли хранятся в JSON, но в контекст модели не попадают — при длинных сессиях «память» модели теряет ход рассуждений (решается компактингом, §7).
- Токены для чужих моделей считаются приближённо (tiktoken-оценка).
- CORS включён только для dev-портов (5173/4173/3000); прод идёт через статику FastAPI.

## 7. Дальнейший план (в порядке приоритета)

1. ~~**Thinking Level**~~ — ✅ выполнено в рамках Задачи №2 (2026-11-22): селектор `Off/Low/Medium/High/Extra High` в правой панели,
   маппинг в `reasoning_effort`, GAS-совместимый `runSettings.thinkingLevel`, depth prompting.
   Остаётся на будущее: отображение уровня в шапке чата.
2. **Парсеры источников во embeddings-контекст**:
   - YouTube (`youtubeVideo`-чанки и обычные ссылки): извлечение субтитров/транскрипта → текстовый вложение-контекст.
   - URL-парсер: `GET /api/parse/url` → читаемый текст страницы (trafilatura/readability-подобный извлечение).
   - DOCX-парсер: извлечение текста/таблиц из `driveDocument`/загруженных `.docx` (python-docx) в `attachmentText`.
3. **Web Search**: инструмент «поиск в вебе» — либо native search у провайдера, либо собственный цикл (search-API → топ-N страниц → контекст), результаты оформляются как GAS-чанки `grounding`/`citations` для совместимости.
4. **Python-песочница**: выполнение `executableCode` из ответов локально (isolated subprocess с лимитами CPU/сети/tmp), результаты — в чанки `codeExecutionResult`, как в GAS; whitelist импортов, таймаут.
5. **Память и компактинг (гибридный RAG)**:
   - индексация истории чатов и вложений (векторы + BM25, гибрид) в `data/index/`;
   - автоматическая подтяжка релевантных фрагментов в контекст при приближении к лимиту окна;
   - компактинг: суммаризация старых фреймов в `isThought`-совместимые сводки, чтобы уместить длинную сессию в контекст без потери фактов;
   - скользящее окно + «ядро памяти» фактов чата в `systemInstruction`/служебном чанке.
