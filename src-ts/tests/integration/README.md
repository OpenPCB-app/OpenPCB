# TaskSystem Integration Tests

These tests verify the complete task execution pipeline with real OpenAI API calls.

## Prerequisites

1. **OpenAI API Key**: Set `OPENAI_API_KEY` environment variable
2. **Backend Server**: Must be running before tests

## Running Tests

### 1. Start the backend server

```bash
npm run dev
```

Note the dynamic port printed in the logs (e.g., `Server running on port 54182`).

### 2. Run integration tests

```bash
# Set the API URL with the dynamic port
TEST_API_URL=http://localhost:54182 bun test tests/integration --timeout 120000
```

### Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `TEST_API_URL` | Backend API base URL | `http://localhost:3000` |

## Test Cases

1. **Async Execution**: Verifies task completes after stream disconnect
2. **Concurrent Chats**: Tests multiple chats running independently
3. **Database Persistence**: Confirms messages are saved correctly
4. **Active Task Detection**: Tests the active task API endpoint

## Behavior

- Tests **skip automatically** if `OPENAI_API_KEY` is not set
- Tests use `gpt-4o-mini` for fast, cost-effective execution
- Each test has generous timeout (60-120s) for API latency

## Troubleshooting

### "Cannot connect to server"
- Ensure backend is running with `npm run dev`
- Check the dynamic port and set `TEST_API_URL` correctly

### Tests timeout
- May indicate network issues or slow API responses
- Increase timeout: `bun test tests/integration --timeout 180000`
