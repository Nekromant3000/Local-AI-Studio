# Local AI Studio — актуальная архитектура, статус и план

Обновлено: 2026-11-25. Документ описывает **реальное состояние кодовой базы**
(`backend/`, `frontend/src/`), а не первоначальный MVP-замысел.

---

## 1. Назначение

Локальный рабочий стол, полностью совместимый с форматом Google AI Studio (GAS):
приложение читает и **редактирует на месте** JSON-чаты из папки
`%USERPROFILE%\Documents\Google AI Studio` (переопределяется переменной
`GAS_CHAT_DIR` или кнопкой «Выбрать папку» в сайдбаре — выбор живёт в
`settings.json` и применяется без перезапуска), а генерацию выполняет через любой
**OpenAI-совместимый локальный API** (LM Studio, Ollama, llama.cpp, Strata и т. п.).

## 2. Запуск

| Компонент | Команда | Адрес |
|---|---|---|
| Backend | `backend\.venv\Scripts\python.exe run.py` (из `backend/`) | `http://127.0.0.1:8000` |
| Frontend (прод-сборка) | `cd frontend && ..\.tools\node\npm.cmd run build` | отдаётся FastAPI из `frontend/dist` |
| Frontend (dev) | `..\.tools\node\npm.cmd run dev` | `http://localhost:5173` (proxy на 8000 в `vite.config.ts`) |

Node.js портативный — в `.tools\node` (для `npm.cmd` нужен `node` в `PATH`).
Зависимости бэкенда — `backend\.venv` (`pip install -r requirements.txt`; `PyMuPDF` и
`pywin32` нужны для миниатюр `.docx`, `pywin32` работает только на Windows и требует
установленного MS Word для «настоящего» рендера первой страницы).
Env-переменные: `LOCAL_AI_STUDIO_HOST/PORT/RELOAD`, `GAS_CHAT_DIR`,
`LOCAL_AI_STUDIO_DATA`. Swagger: `/api/docs`.

## 3. Структура и модули

### Backend (`backend/`, FastAPI + httpx + Pillow + tiktoken + python-docx + PyMuPDF + pywin32)

| Модуль | Ответственность |
|---|---|
| `app/main.py` | приложение, lifespan (очистка uploads/thumbnails по сроку), CORS, обработчики ошибок, статика `frontend/dist`, корневой `/health` |
| `app/config.py` | пути (`CHAT_DIR`, `DATA_DIR`, uploads/backups/thumbnails, `settings.json`), `DEFAULT_SETTINGS` (в т. ч. `chatDir` — активная папка чатов, приоритет: `settings.json` → `GAS_CHAT_DIR` → Documents), `DEFAULT_CHAT_RUN_SETTINGS` (в т. ч. `thinkingLevel`), константы уровней мышления (`THINKING_LEVELS`, маппинги в `reasoning_effort` и GAS `thinkingLevel`, `normalize_thinking_level`), `set_chat_dir`/`ChatDirError` (смена папки в рантайме: валидация, ребинг `CHAT_DIR` во всех модулях пакета, сохранение, сброс кэшей), атомарное сохранение настроек |
| `app/gas_store.py` | индекс папки GAS (mtime-кэш, `invalidate_cache(full=True)` при смене папки), `get_document/create_chat/save_document/rename_chat/delete_chat` (в `data/trash`), бэкапы перед записью, `estimate_chat_tokens`, `default_chat` |
| `app/attachments.py` | разбор `driveImage/inlineImage/driveDocument/youtubeVideo/...`, санитизация чата перед отправкой в браузер (inline base64 → lazy-endpoint), «обезвреживание» и реконструкция (`rehydrate_chat`) при сохранении, привязка Drive-объектов к локальным файлам, Temp-файлы загрузок, `docx_sidecar` — сайдкей-файлы `.docx` (оригинал + миниатюра + страницы) находятся по SHA-1 контента и дают `docxUrl`/`thumbUrl`/`docxPagesUrl`/исходное имя **без записи новых полей в GAS-JSON** |
| `app/llm.py` | OpenAI-совместимый стриминг: `list_models`, `build_messages` (чаты GAS → messages с картинками/файлами + depth-prompting блок `<system_reminder>`), `ThinkTagFilter` (перехват `<think>` в reasoning-канал), поддержка `reasoning_content`, `reasoning_effort` по уровню мышления, подготовка усечения контекста, генерация GAS-чанков ответа (`make_generated_chunks`, `thinkingBudget: -1`) |
| `app/tokens.py` | tiktoken с кэшем и graceful fallback на эвристику; `count_request` учитывает текст вложений (`attachmentText`) и URL-контекст (`urls`, `urlItems`) |
| `app/docx.py` | `docx_bytes_to_markdown` (python-docx): заголовки/списки/таблицы `.docx` → читаемый Markdown без потери структуры |
| `app/docx_preview.py` | PNG-изображения `.docx`: миниатюра **первой страницы** (~360 px) и **полноразмерные страницы предпросмотра** (~1100 px, до 15 стр., `generate_docx_pages`): MS Word через COM (`pywin32` → `ExportAsFixedFormat` в PDF, `_docx_to_pdf_bytes`) → PyMuPDF (`pymupdf`/`fitz`) растеризует страницы; если Word/COM/PDF недоступны — Pillow-превью белого листа A4 с реальным заголовком, первыми строками и таблицами (масштабируется под `width`) |
| `app/url_context.py` | URL-контекст: `normalize_url` (https, без фрагментов/хвостовой пунктуации), `url_id` = SHA-1 нормализованного URL, `urls_in_chat` (user-чанки), загрузка страниц (`httpx` + браузерный UA → `trafilatura`, fallback BeautifulSoup4), кэш в `data/url_cache/`, исключения в `data/chat_meta/` (не трогают JSON чата) |
| `app/utils.py` | атомарная запись JSON, валидация имён, id/имена файлов чатов |
| `app/routers/system.py` | `/api/health` (в т. ч. `chatDir`), `/api/settings` GET/PUT (валидация baseUrl/ключей/лимитов, `urlContext`), `POST /api/system/select-chat-dir` (нативный диалог выбора папки через tkinter в отдельном процессе python → `set_chat_dir`; опциональный query-параметр `path` для программной смены без диалога), `/api/tokens/count` (принимает `chatId` + `urlContext`, считает реальный текст вложений и URL-контекст) |
| `app/routers/chats.py` | CRUD чатов + `POST /api/chats/{id}/generate` (SSE: `token`, `reasoning_delta`, `done`, `error`, heartbeat), `GET /api/chats/{id}/assets/{chunk}/{slot}`, `GET/PUT /api/chats/{id}/url-context` (ссылки чата и исключения; metadata в `data/chat_meta/`, JSON чата не меняется) |
| `app/routers/assets.py` | `POST /api/assets/upload` (в т. ч. `.docx` → Markdown: оригинал в `data/attachments/{assetId}.docx` + `{assetId}.meta.json` + сразу генерируется `{assetId}.thumb.png`, в чат идёт только текст; `assetId` = SHA-1 от base64 тех байт Markdown, что попадут в чат, — поэтому сайдкей находится позже прямо из JSON чата без нестандартных полей), `POST /api/assets/extract-url` (загрузка+парсинг страницы в кэш), `GET /api/uploads/{id}`, `GET /api/assets/docx-thumb/{assetId}` (PNG первой страницы, ленивая генерация при первом запросе), `GET /api/assets/docx-pages/{assetId}` (JSON-список полноэкранных PNG-страниц ~1100px, до 15, кэш `{assetId}.pageN.png` + манифест `{assetId}.pages.json`), `GET /api/assets/docx-page/{assetId}/{page}` (отдельная PNG-страница), `GET /api/assets/docx-file/{assetId}` (скачивание оригинала `.docx`), `GET /api/assets/local` (скан папки GAS), `/api/assets/local/file`, `/api/assets/local/thumb` (Pillow) |
| `app/routers/llm.py` | `GET /api/llm/models` (по baseUrl/apiKey), `GET /api/llm/presets` (легаси — фронтенд пресеты не читает, они захардкожены в `RightPanel.tsx`) |
| `data/` | `settings.json` (глобальные настройки + API-ключ), `backups/`, `uploads/`, `thumbnails/`, `attachments/` (оригиналы `.docx`, `*.meta.json` и `*.thumb.png` миниатюры), `trash/` |

### Frontend (`frontend/src/`, React 18 + Vite + TS + Tailwind + Zustand)

| Модуль | Ответственность |
|---|---|
| `App.tsx` | каркас: Sidebar / ChatHeader / ChatWorkspace / Composer / RightPanel, мобильные оверлеи, тосты ошибок/уведомлений, хоткеи (`Ctrl+B`, `Esc`) |
| `store/useAppStore.ts` | единый Zustand-store: чаты, документ, оптимистичные правки через `updateChat` + debounce-сохранение, SSE-генерация, настройки (`useLocalSettings` = слияние глобальных и `runSettings.localApi` чата), `setSystemInstruction`, загрузка моделей |
| `lib/api.ts`, `lib/frames.ts`, `lib/links.ts` | клиент API (+url-context, extractUrl, `selectChatDir`); единая нормализация ошибок сервера (`formatErrorDetail`/`extractErrorMessage`: строка, `{message}`, FastAPI-422 с массивом `detail` → человекочитаемый текст, без `[object Object]`); `requestHeaders` не ставит `Content-Type: application/json` для `FormData` (иначе FastAPI не видит файл → 422); разбор GAS-чанков в «фреймы» (сообщения, мысли, вложения, code execution, grounding); `links.ts` — тот же regex/нормализация URL, что в бэкенде, для совпадения чипов с серверными элементами |
| `components/` | `Sidebar` (поиск/создание/переименование/удаление; в нижней пластине — кнопка **«Выбрать папку»**: системный диалог выбора папки чатов, перечитывание списка без перезапуска), `ChatWorkspace` + `MessageFrame` (у **user-сообщений вложения вынесены из рамки текста наружу**: каждый файл — отдельный блок-фрейм сверху, текст — отдельная плашка под ними; у модели вложения остаются над текстом) + `StreamingMessage` + `ThinkingBlock` (тайминг размышлений; **drag-and-drop файлов прямо в окно чата** с подсветкой-оверлеем → очередь `uploadQueue`, которую забирает Composer), `Composer` (pendingInputs, стоп-генерация, человекочитаемые ошибки загрузки вида `«имя файла»: …`; поле ввода растёт до ~200px, дальше скроллится внутри себя с тёмным скроллбаром, а кнопка-иконка `Maximize2` в углу поля открывает развёрнутое модальное окно ввода ~75vh с синхронным текстом и кнопками «Готово»/«Отправить», `Ctrl+Enter` — отправить), `AttachmentPicker/Grid` (выбор слотов image/file, локальные файлы, превью; **каждое вложение — отдельный крупный блок в строго вертикальном столбце** `flex flex-col items-start gap-3` без горизонтального скролла: изображение до 540px с полным именем и бейджем формата без обрезки, крупный лист `.docx` ~360px (A4) с миниатюрой первой страницы, реальным именем и размером, файл/Drive/YouTube-карточки; у каждой карточки свои «глаз», скачать и удалить), `DocxPreviewModal` (модалка предпросмотра `.docx`: вкладки **«Документ (страницы)»** — вертикальная прокрутка реальных PNG-страниц ~1100px, и **«Извлечённый текст (Markdown)»** — как документ видит модель), `UrlContextChips` (компактные чипы ссылок под user-сообщениями: домен/заголовок, токены, `×` — исключить), `PreviewModal`, `RightPanel`, `CodeBlock`, `MarkdownView`, `Modal`, `ConfirmDialog`, `CopyButton`, `EmptyState` |
| `RightPanel.tsx` | панель «Контекст и модель»: статистика токенов с прогресс-баром (в т. ч. рядок «URL»); System Instructions (инлайн + модалка, см. §5); «Локальный API» — Base URL + пресеты **Strata / LM Studio / Ollama / llama.cpp** (Strata: ключ `strata-local` + автообновление списка с автовыбором модели), модель — dropdown из `/api/llm/models` с режимом ручного ввода, API Key (глобально); параметры генерации — Thinking Level (`Off / Low / Medium / High / Extra High`), Temperature/Max Output (блокируются при мышлении), Top P, Context Window, отправка вложений, **URL Context** (тумблер, по умолчанию включён) |

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
- **Задача №3 выполнена (2026-11-22)**:
  - **DOCX**: загрузка `.docx` прямо в Composer (никакого копирования в папку GAS). `app/docx.py` (python-docx) превращает абзацы/заголовки/списки/таблицы в читаемый Markdown; оригинальный файл хранится локально в `data/attachments/{tempId}.docx`, а в JSON чата оказывается только извлечённый текст (`inlineFile`, `mimeType: text/markdown`, `convertedFrom: docx`) — полная GAS-совместимость, MIME `.docx` в чат не пишется. Текст учитывается в токенах (`attachmentText`); легасиевые GAS-документы (`driveDocument` с `.docx`) тоже декодируются при генерации.
  - **URL Context**: тумблер «URL Context» в правой панели (по умолчанию включён, хранится в `runSettings.localApi.urlContext` + глобальная настройка). Ссылки из user-сообщений (`chunkedPrompt.chunks`) извлекаются regex'ом с нормализацией (https, без фрагментов/хвостовой пунктуации; `urlId` = SHA-1). `POST /api/assets/extract-url` скачивает страницу (`httpx`, браузерный UA, 20 с) и вытаскивает основной текст `trafilatura` (fallback — BeautifulSoup4); кэш страниц — `data/url_cache/{urlId}.json` (без TTL, ошибки не кэшируются). Извлечённый текст добавляется в контекст модели **только в рантайме** (`build_messages` дописывает блоки `[Веб-страница: …]` к последнему user-сообщению) — исходный JSON чата никогда не меняется. Лимиты: 12 ссылок на чат, 20 000 символов на страницу.
  - **UI**: под каждым user-сообщением — компактные чипы ссылок (домен/заголовок, число токенов, статус кэша); `×` на чипе исключает ссылку из контекста (исключения в `data/chat_meta/{hash}.json`, чат не трогается); исчезнувшие при редактировании сообщениями ссылки автоматически перестают учитываться; в панели токенов — рядок «URL».
- **Задача №4 выполнена (2026-11-25)**:
  - **Ошибка `[object Object]` исправлена в корне**: причина была в `lib/api.ts` — `FormData`-загрузки отправлялись с заголовком `Content-Type: application/json`, из-за чего FastAPI не видел поле `file` и отвечал 422 с массивом `detail`; `String(detail)` на массиве объектов и давал `[object Object]`. Теперь `requestHeaders` не ставит JSON-тип для `FormData` (браузер сам генерирует multipart-boundary), а `formatErrorDetail`/`extractErrorMessage` превращают любой ответ сервера (строка, `{message}`, FastAPI-422) в понятный текст; ошибки загрузки в Composer — вида `«docx»: Field required — file`. Все загрузки (картинки, тексты, `.docx`) снова работают.
  - **Drag-and-drop в окно чата**: файлы можно бросать не только в Composer, но и прямо на список сообщений (`ChatWorkspace` — оверлей «Отпустите файлы…», очередь `uploadQueue` в store, которую забирает Composer; без открытого чата — понятная ошибка).
  - **Смена папки чатов из UI**: кнопка «Выбрать папку» в нижней пластине Sidebar → `POST /api/system/select-chat-dir` открывает нативное системное окно выбора папки (tkinter `filedialog.askdirectory` в отдельном процессе python — не блокирует event loop), затем `set_chat_dir` валидирует путь, мгновенно переключает `CHAT_DIR` во всех модулях (ребинг глобалов пакета + полный сброс кэшей индексатора) и сохраняет в `settings.json` (`chatDir`; приоритет: `settings.json` → `GAS_CHAT_DIR` → Documents). Сайдбар перечитывает список чатов без перезапуска сервера; `/api/health` показывает активную `chatDir`.

- **Задача №5 выполнена (2026-11-25)**:
  - **Composer: прокрутка + развёрнутый режим**. Пока текст короткий, поле растёт как раньше; после ~200px появляется внутренняя вертикальная прокрутка с тёмным скроллбаром (высота ленты чата не скачет). В правом верхнем углу поля — компактная кнопка `Maximize2`, открывающая модальное окно ввода (~75% высоты экрана) с той же очередью вложений и большой областью редактирования: «Готово» закрывает окно (черновик сохраняется), «Отправить» отправляет, `Ctrl+Enter` тоже отправляет, `Esc` закрывает.
  - **Вложения — отдельные карточки над текстом**. В ленте чата `AttachmentGrid` вынесен **перед** текстом/code-блоком сообщения, и каждое вложение теперь самостоятельная карточка в `flex-wrap`-ряду (без общей рамки-контейнера): изображение, лист `.docx`, файл, Drive/YouTube-объекты. У каждой карточки свои кнопки «предпросмотр», «скачать» и «удалить», ряд выравнивается по высоте (`items-stretch`).
  - **Миниатюра первой страницы `.docx`**. Новый `app/docx_preview.py`: сначала настоящий рендер через установленный MS Word — COM (`pywin32`, `Word.Application` → `ExportAsFixedFormat` в PDF) и растеризация 1-й страницы PyMuPDF с уплотнением до ~360px (LANCZ); если Word/COM/PDF недоступны или документ битый — Pillow-превью белого листа A4 с фактическим заголовком, первыми абзацами/списками и сеткой таблиц из `.docx`. Миниатюра генерируется при загрузке в фоне (`run_in_threadpool`, ошибка не ломает загрузку) и кладётся в `data/attachments/{assetId}.thumb.png`; повторные запросы отдаются из кэша, а для чатов, загруженных раньше, догенерируется при первом обращении.
  - **GAS-совместимость сохранена полностью**: в JSON чата по-прежнему только `inlineFile` с извлечённым Markdown (`mimeType: text/markdown`, `convertedFrom: docx`) — никаких новых полей. Оригинальный `.docx`, `*.meta.json` (имя/размер) и `*.thumb.png` — сайдкей-файлы на диске, ключ = SHA-1 от base64 тех же байт Markdown, что пишутся в чат; `attachment_meta` вычисляет `docxUrl`/`thumbUrl` и подставляет исходное имя файла только в ответ браузеру, а `rehydrate_chat` вырезает это перед записью.
  - **Зависимости**: `PyMuPDF>=1.24`, `pywin32>=306` (только `sys_platform == "win32"`), Pillow уже был. В чипе загруженного `.docx` и в карточке сообщения показывается миниатюра, скачивание ведёт на `/api/assets/docx-file/{assetId}`.

- **Задача №6 выполнена (2026-11-25)**:
  - **Вложения — вертикальный стек отдельных крупных блоков (без горизонтального скролла)**. `AttachmentGrid` переведён с `flex flex-wrap items-stretch gap-2` (горизонтальный ряд) на **строго вертикальный столбец** `flex flex-col items-start gap-3` — любое число вложений листается только вертикально колёсиком, как в оригинальном Google AI Studio. Карточки укрупнены: изображение — превью до **540px** с сохранением пропорций и без обрезки (`object-contain`), полное имя без обрезки + бейдж формата (расширение) + кнопки действий; `.docx` — крупный лист A4 **~360px** с миниатюрой, **реальным оригинальным именем**, размером и кнопками; файл/Drive/YouTube-карточки — до 420px. В `MessageFrame` у пользовательских сообщений рендер вложений вынесен **из рамки текста наружу**: каждое вложение — самостоятельный блок-фрейм сверху, а текст сообщения — отдельная плашка под ними.
  - **Постраничный визуальный предпросмотр `.docx` (вместо только Markdown)**. `docx_preview.generate_docx_pages` рендерит **все страницы** (до 15) через Word COM → PDF → PyMuPDF в PNG **~1100px по ширине**; без Word — Pillow-фолбэк (масштабируемая страница-превью). Новые эндпоинты: `GET /api/assets/docx-pages/{assetId}` (JSON-список страниц + ленивый кэш `{assetId}.pageN.png`/манифест `{assetId}.pages.json`) и `GET /api/assets/docx-page/{assetId}/{page}` (PNG). `docx_sidecar` добавляет `docxPagesUrl` в мету (GAS-JSON не трогается — срезается `rehydrate_chat`). В новой модалке `DocxPreviewModal` переключатель вкладок: **«Документ (страницы)»** (по умолчанию, вертикальная прокрутка реальных страниц в высоком качестве) и **«Извлечённый текст (Markdown)»** (как документ видит модель).
  - **GAS-совместимость и тесты**: по-прежнему никаких новых полей в JSON чата. Сквозная проверка на живом сервере: загрузка `.docx` → `docx-pages` вернул 2 страницы (`source: word`), `docx-page/0` отдал PNG `1100×1424`; Pillow-фолбэк отдельно даёт 1 страницу `~1100px`.


**UX**
- Тёмная тема, glass-панели, адаптив (мобильные оверлеи панелей ≥1280px desktop), тосты, confirm-диалоги, копирование сообщений, автоскролл, stop-generation.

## 6. Известные особенности / техдолг

- `GET /api/llm/presets` на бэкенде устарел: фронтенд держит свой список в `RightPanel.tsx` (единый источник стоит перенести на бэкенд или удалить роут).
- Мысли хранятся в JSON, но в контекст модели не попадают — при длинных сессиях «память» модели теряет ход рассуждений (решается компактингом, §7).
- Токены для чужих моделей считаются приближённо (tiktoken-оценка).
- CORS включён только для dev-портов (5173/4173/3000); прод идёт через статику FastAPI.
- Лайфспан `main.py` чистит только `uploads/` и `thumbnails/`; сайдкей-файлы `data/attachments/` (оригиналы `.docx`, миниатюры `*.thumb.png` и страницы `*.pageN.png` + манифесты `*.pages.json`) не удаляются — нужен TTL/сборщик мусора по чатам.
- Миниатюра `.docx` зависит от установленного MS Word: без него работает Pillow-fallback (структура документа, не типографика); Word COM запускается в отдельных потоках пула, при массовых загрузках это заметно по времени.

## 7. Дальнейший план (в порядке приоритета)

1. ~~**Thinking Level**~~ — ✅ выполнено в рамках Задачи №2 (2026-11-22): селектор `Off/Low/Medium/High/Extra High` в правой панели,
   маппинг в `reasoning_effort`, GAS-совместимый `runSettings.thinkingLevel`, depth prompting.
   Остаётся на будущее: отображение уровня в шапке чата.
2. **Парсеры источников во embeddings-контекст**:
   - URL-парсер — ✅ выполнено в рамках Задачи №3 (2026-11-22): `POST /api/assets/extract-url` + кэш `data/url_cache/` + рантайм-инъекция в контекст модели (см. §5).
   - DOCX-парсер — ✅ выполнено в рамках Задачи №3 (2026-11-22): `app/docx.py` (python-docx), текст идёт в чат как Markdown, оригинал в `data/attachments/`; миниатюра первой страницы — ✅ Задача №5 (2026-11-25).
   - YouTube (`youtubeVideo`-чанки и обычные ссылки): извлечение субтитров/транскрипта → текстовый вложение-контекст (пока не сделано).
3. **Web Search**: инструмент «поиск в вебе» — либо native search у провайдера, либо собственный цикл (search-API → топ-N страниц → контекст), результаты оформляются как GAS-чанки `grounding`/`citations` для совместимости.
4. **Python-песочница**: выполнение `executableCode` из ответов локально (isolated subprocess с лимитами CPU/сети/tmp), результаты — в чанки `codeExecutionResult`, как в GAS; whitelist импортов, таймаут.
5. **Память и компактинг (гибридный RAG)**:
   - индексация истории чатов и вложений (векторы + BM25, гибрид) в `data/index/`;
   - автоматическая подтяжка релевантных фрагментов в контекст при приближении к лимиту окна;
   - компактинг: суммаризация старых фреймов в `isThought`-совместимые сводки, чтобы уместить длинную сессию в контекст без потери фактов;
   - скользящее окно + «ядро памяти» фактов чата в `systemInstruction`/служебном чанке.
