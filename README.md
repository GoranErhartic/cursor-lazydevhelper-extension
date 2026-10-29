# LazyDevHelper

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Me-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/goranlegenda)

Adds right-click AI code actions in Cursor for selected code: Analyze, Review, and Simplify.

## Requirements

- Cursor (latest stable recommended)
- A configured LLM provider (`OpenAI`, `Anthropic`, or `Cursor`) with a valid API key/session where required

## Usage

1. Install the extension from VSIX, or press `F5` in this repo to launch an Extension Development Host.
2. Select code in the editor and open the context menu.
3. Use **LazyDevHelper** actions:
   - `Analyze Code`
   - `Review Code`
   - `Simplify Code`
4. Configure provider and model from commands:
   - `LazyDevHelper: Configure API Key & Provider`
   - `LazyDevHelper: Select Model`

## Settings

| Setting | Default | Description |
|--------|---------|-------------|
| `lazydev.provider` | `openai` | LLM provider used for code actions |
| `lazydev.model` | *(empty)* | Model ID selected after provider setup |
| `lazydev.maxSelectionChars` | `50000` | Maximum selected characters sent to the model |

## Development

```bash
pnpm install
pnpm run compile
pnpm test
```

## Publishing (Open VSX)

The extension ID is `goranerhartic.lazydevhelper` (publisher `goranerhartic`).

1. Sign in at [open-vsx.org](https://open-vsx.org) with GitHub, sign the Publisher Agreement, and create an access token.
2. Create the namespace (once): `npx ovsx create-namespace goranerhartic -p <token>`
3. Claim ownership of the namespace via the Open VSX namespace-claim issue.
4. Build and publish: `pnpm run package && pnpm dlx ovsx publish lazydevhelper-<version>.vsix -p <token>`

## Privacy

Any API key you provide via extension setup is used only to call the configured provider APIs needed for your prompts. The extension does not intentionally log or transmit your keys anywhere else.

## Support

If you find this project useful, consider supporting its development:

Buy me a coffee at [ko-fi.com/goranlegenda](https://ko-fi.com/goranlegenda).
