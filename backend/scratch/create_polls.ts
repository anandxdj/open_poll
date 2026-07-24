import axios from 'axios';

const BASE_URL = 'http://127.0.0.1:5000/mcp';
const TOKEN = process.env.MCP_TOKEN || "your_mcp_token_here";

function parseSseResponse(data: unknown): any {
  if (typeof data !== 'string') {
    return data;
  }
  const lines = data.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.substring(6));
      } catch (e) {
        console.error('Failed to parse data line as JSON:', line, e);
      }
    }
  }
  return null;
}

async function sendMcpRequest(url: string, body: any, headers: any) {
  const response = await axios.post(url, body, {
    headers,
    responseType: 'text'
  });

  const rawText = response.data;
  const parsed = parseSseResponse(rawText);
  return {
    headers: response.headers,
    rawText,
    parsed
  };
}

async function run() {
  console.log('=== Initializing MCP Session ===');
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };

  // 1. Initialize session
  const initResult = await sendMcpRequest(BASE_URL, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'poll-creator-client',
        version: '1.0.0'
      }
    },
    id: 1
  }, headers);

  const sessionId = initResult.headers['mcp-session-id'];
  if (!sessionId) {
    throw new Error('No session ID returned in headers!');
  }

  const sessionHeaders = {
    ...headers,
    'mcp-session-id': sessionId
  };

  // Poll definitions
  const pollsToCreate = [
    {
      title: 'Frontend Framework in 2026 🎨',
      isAnonymous: false,
      questions: [
        {
          text: 'Which frontend framework/library is your primary choice?',
          options: ['React / Next.js', 'Vue / Nuxt.js', 'Svelte / SvelteKit', 'Solid / SolidStart', 'HTML + Vanilla JS']
        }
      ]
    },
    {
      title: 'Preferred Database for Web Apps 🗄️',
      isAnonymous: false,
      questions: [
        {
          text: 'What is your default database for new projects?',
          options: ['PostgreSQL', 'MongoDB', 'Redis', 'MySQL', 'SQLite']
        }
      ]
    },
    {
      title: 'AI Integration Level in Apps 🤖',
      isAnonymous: false,
      questions: [
        {
          text: 'How do you integrate AI in your current projects?',
          options: [
            'Direct LLM API calls (Gemini/OpenAI/Anthropic)',
            'Frameworks like LangChain / LlamaIndex',
            'Fully local open-source models (Ollama/vLLM)',
            'No AI integration yet'
          ]
        }
      ]
    }
  ];

  const results: Array<{ title: string; pollId: string; shareUrl: string }> = [];

  let idCounter = 2;
  for (const pollConfig of pollsToCreate) {
    console.log(`\nCreating poll: "${pollConfig.title}"...`);
    
    // Call create_poll
    const createResult = await sendMcpRequest(BASE_URL, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'create_poll',
        arguments: pollConfig
      },
      id: idCounter++
    }, sessionHeaders);

    const pollDataRaw = createResult.parsed?.result?.content?.[0]?.text;
    if (!pollDataRaw) {
      console.error('Failed to create poll or receive valid content:', createResult.parsed);
      continue;
    }

    const poll = JSON.parse(pollDataRaw).poll;
    const pollId = poll._id;

    // Call get_share_link
    const shareResult = await sendMcpRequest(BASE_URL, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_share_link',
        arguments: { pollId }
      },
      id: idCounter++
    }, sessionHeaders);

    const shareDataRaw = shareResult.parsed?.result?.content?.[0]?.text;
    const shareUrl = shareDataRaw ? JSON.parse(shareDataRaw).shareUrl : 'N/A';

    results.push({
      title: poll.title,
      pollId,
      shareUrl
    });
  }

  console.log('\n=== Poll Generation Complete ===\n');
  console.log(JSON.stringify(results, null, 2));
}

run().catch((err) => {
  console.error('Execution failed:', err.response?.data || err.message || err);
});
