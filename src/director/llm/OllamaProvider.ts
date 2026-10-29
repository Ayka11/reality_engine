export interface OllamaOpts {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export class OllamaProvider {
  baseUrl: string;
  model?: string;

  constructor(opts: OllamaOpts = {}) {
    this.baseUrl = opts.baseUrl || 'http://localhost:11434';
    this.model = opts.model;
  }

  async generate(prompt: string, opts: any = {}) {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/generate`;
    const body: any = { prompt };
    if (this.model) body.model = this.model;
    if (opts.model) body.model = opts.model;
    // merge other options (temperature, max_tokens, etc.) if provided
    Object.assign(body, opts);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        if (res.status === 404) throw new Error('Ollama API not found (404)');
        const txt = await res.text();
        throw new Error(`Ollama API error ${res.status}: ${txt}`);
      }

      let data: any;
      try {
        data = await res.json();
      } catch (e) {
        data = await res.text();
      }

      let text = '';
      if (!data) text = '';
      else if (typeof data === 'string') text = data;
      else if (typeof data.text === 'string') text = data.text;
      else if (Array.isArray(data.output) && data.output.length) {
        text = data.output.map((o: any) => o.content || o.text || JSON.stringify(o)).join('\n');
      } else if (data.choices && data.choices[0]) {
        const c = data.choices[0];
        text = c.message?.content || c.text || JSON.stringify(c);
      } else {
        text = JSON.stringify(data);
      }

      return { text, raw: data };
    } catch (err: any) {
      return { error: String(err?.message || err) };
    }
  }
}
