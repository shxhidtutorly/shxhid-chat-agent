/**
 * UI/UX REWRITE – VISUAL PARITY WITH REFERENCE
 * Backend logic preserved
 */
(function() {
  'use strict';

  const ShopAIChat = {
    state: {
      isOpen: false,
      history: [],
      conversationId: sessionStorage.getItem('shopAiConversationId'),
      isThinking: false
    },

    elements: {},

    init: function() {
      // Cache DOM elements
      this.elements = {
        floatingGroup: document.getElementById('shop-ai-floating-group'),
        modal: document.getElementById('shop-ai-modal'),
        backdrop: document.getElementById('shop-ai-backdrop'),
        messages: document.getElementById('shop-ai-messages'),
        input: document.getElementById('shop-ai-input'),
        sendBtn: document.getElementById('shop-ai-send-btn'),
        closeBtn: document.getElementById('shop-ai-close-btn'),
        menuBtn: document.getElementById('shop-ai-menu-btn'),
        menuDropdown: document.getElementById('shop-ai-menu'),
        suggestions: document.getElementById('shop-ai-suggestions')
      };

      if (!this.elements.floatingGroup) return; // Guard

      this.setupEventListeners();
      this.restoreHistory();
    },

    setupEventListeners: function() {
      // Floating Buttons
      const triggers = document.querySelectorAll('[data-trigger]');
      triggers.forEach(btn => btn.addEventListener('click', () => this.open()));

      // Close & Backdrop
      this.elements.closeBtn.addEventListener('click', () => this.close());
      this.elements.backdrop.addEventListener('click', () => this.close());

      // Menu Toggle
      this.elements.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.elements.menuDropdown.classList.toggle('active');
      });
      document.addEventListener('click', () => this.elements.menuDropdown.classList.remove('active'));

      // Menu Actions
      const menuActions = document.querySelectorAll('.shop-ai-menu-item');
      menuActions.forEach(action => {
        action.addEventListener('click', (e) => {
          const type = e.currentTarget.dataset.action;
          if(type === 'new') this.startNewChat();
          if(type === 'end') this.close(); // Simplified for UI
        });
      });

      // Input Handling
      this.elements.input.addEventListener('input', (e) => {
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
        const hasText = e.target.value.trim().length > 0;
        this.elements.sendBtn.classList.toggle('active', hasText);
      });

      this.elements.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSubmit();
        }
      });

      this.elements.sendBtn.addEventListener('click', () => this.handleSubmit());
    },

    open: function() {
      document.body.classList.add('shop-ai-open');
      this.elements.floatingGroup.classList.add('hidden');
      this.state.isOpen = true;
      // Focus input after animation
      setTimeout(() => this.elements.input.focus(), 400);
    },

    close: function() {
      document.body.classList.remove('shop-ai-open');
      this.elements.floatingGroup.classList.remove('hidden');
      this.state.isOpen = false;
    },

    startNewChat: function() {
      sessionStorage.removeItem('shopAiConversationId');
      this.state.conversationId = null;
      this.elements.messages.innerHTML = '';
      this.elements.messages.appendChild(this.elements.suggestions); // Move suggestions back
      this.elements.suggestions.classList.add('visible');
    },

    handleSubmit: function() {
      const text = this.elements.input.value.trim();
      if (!text) return;

      // Hide suggestions
      this.elements.suggestions.classList.remove('visible');

      // Add user message
      this.addMessage(text, 'user');
      this.elements.input.value = '';
      this.elements.input.style.height = 'auto';
      this.elements.sendBtn.classList.remove('active');

      // Start streaming
      this.startStream(text);
    },

    // Exposed for onclick in HTML
    send: function(text) {
      this.elements.input.value = text;
      this.handleSubmit();
    },

    addMessage: function(content, role) {
      const div = document.createElement('div');
      div.className = `shop-ai-message ${role}`;
      
      const bubble = document.createElement('div');
      bubble.className = 'shop-ai-bubble';
      
      if (role === 'assistant') {
        // Simple markdown parser
        let html = content
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
        bubble.innerHTML = html;
      } else {
        bubble.textContent = content;
      }

      div.appendChild(bubble);
      this.elements.messages.appendChild(div);
      this.scrollToBottom();
      return div;
    },

    // ---------------------------------------------------------
    // THINKING UI (3-STAGE ANIMATION)
    // ---------------------------------------------------------
    showThinking: function() {
      if (this.state.isThinking) return;
      this.state.isThinking = true;

      const container = document.createElement('div');
      container.className = 'shop-ai-thinking-container active';
      container.id = 'shop-ai-thinking-ui';

      // Stage 1: Thought about
      container.innerHTML = `
        <div class="shop-ai-step current" id="step-1">
          <div class="shop-ai-step-icon"><div class="shop-ai-spinner"></div></div>
          <span>Thought about the question</span>
        </div>
        <div class="shop-ai-step" id="step-2">
          <div class="shop-ai-step-icon"></div>
          <span id="step-2-text">Scouting store...</span>
        </div>
        <div class="shop-ai-step" id="step-3">
          <div class="shop-ai-step-icon"></div>
          <span>Thinking...</span>
        </div>
      `;

      this.elements.messages.appendChild(container);
      this.scrollToBottom();
      
      // Simulate progress to stage 2 automatically after 1s
      setTimeout(() => this.updateThinkingStage(2), 1000);
    },

    updateThinkingStage: function(stage, customText) {
      const ui = document.getElementById('shop-ai-thinking-ui');
      if (!ui) return;

      const s1 = ui.querySelector('#step-1');
      const s2 = ui.querySelector('#step-2');
      const s3 = ui.querySelector('#step-3');

      // Checkmark SVG
      const check = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
      const spinner = `<div class="shop-ai-spinner"></div>`;
      const pulse = `<div class="shop-ai-pulse-dot"></div>`;

      if (stage === 2) {
        s1.classList.replace('current', 'done');
        s1.querySelector('.shop-ai-step-icon').innerHTML = check;
        
        s2.classList.add('current');
        s2.querySelector('.shop-ai-step-icon').innerHTML = spinner;
        if(customText) s2.querySelector('#step-2-text').textContent = customText;
      }

      if (stage === 3) {
        s2.classList.replace('current', 'done');
        s2.querySelector('.shop-ai-step-icon').innerHTML = check;

        s3.classList.add('current');
        s3.querySelector('.shop-ai-step-icon').innerHTML = pulse;
      }
    },

    removeThinking: function() {
      const ui = document.getElementById('shop-ai-thinking-ui');
      if (ui) ui.remove();
      this.state.isThinking = false;
    },

    // ---------------------------------------------------------
    // PRODUCT RENDERING (ROW-WISE)
    // ---------------------------------------------------------
    renderProducts: function(products) {
      if (!products || !products.length) return;

      const container = document.createElement('div');
      container.style.marginBottom = '20px';

      products.forEach(p => {
        const card = document.createElement('div');
        card.className = 'shop-ai-product-row';
        
        // Image
        const img = document.createElement('img');
        img.className = 'shop-ai-prod-img';
        img.src = p.image_url || '';
        img.alt = p.title;

        // Details
        const details = document.createElement('div');
        details.className = 'shop-ai-prod-info';
        
        const title = document.createElement('div');
        title.className = 'shop-ai-prod-title';
        title.textContent = p.title;

        const price = document.createElement('div');
        price.className = 'shop-ai-prod-price';
        // Handle price range object or string
        let priceTxt = p.price;
        if(p.price_range) {
            priceTxt = `${p.price_range.min} ${p.price_range.currency || ''}`;
        }
        price.textContent = priceTxt;

        const btn = document.createElement('button');
        btn.className = 'shop-ai-prod-btn';
        btn.textContent = 'Add to cart';
        btn.onclick = () => this.send(`Add ${p.title} to my cart`);

        details.appendChild(title);
        details.appendChild(price);
        details.appendChild(btn);

        card.appendChild(img);
        card.appendChild(details);
        container.appendChild(card);
      });

      this.elements.messages.appendChild(container);
      this.scrollToBottom();
    },

    // ---------------------------------------------------------
    // API & STREAMING
    // ---------------------------------------------------------
    startStream: async function(userMessage) {
      this.showThinking();

      try {
        const response = await fetch(window.shopChatConfig.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMessage,
            conversation_id: this.state.conversationId,
            prompt_type: 'standardAssistant'
          })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentMsg = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              
              // Handle Types
              if (data.type === 'id') {
                this.state.conversationId = data.conversation_id;
                sessionStorage.setItem('shopAiConversationId', data.conversation_id);
              }
              
              if (data.type === 'tool_use') {
                // Parse tool name for effect
                let toolName = "Scouting store...";
                if(data.tool_use_message.includes("search")) toolName = "Searching catalog...";
                if(data.tool_use_message.includes("cart")) toolName = "Updating cart...";
                this.updateThinkingStage(2, toolName);
              }

              if (data.type === 'product_results') {
                this.removeThinking(); // Stop thinking before showing products
                this.renderProducts(data.products);
              }

              if (data.type === 'chunk') {
                if (this.state.isThinking) {
                  this.updateThinkingStage(3);
                  // Brief delay to show "Thinking" before text appears
                  this.removeThinking();
                }

                if (!currentMsg) {
                  currentMsg = this.addMessage('', 'assistant');
                }
                const bubble = currentMsg.querySelector('.shop-ai-bubble');
                // Append text (simple stream)
                bubble.innerHTML += data.chunk.replace(/\n/g, '<br>');
                this.scrollToBottom();
              }
            }
          }
        }
      } catch (err) {
        this.removeThinking();
        this.addMessage("Sorry, I encountered an error. Please try again.", 'assistant');
      }
    },

    scrollToBottom: function() {
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    },

    restoreHistory: function() {
      // Basic placeholder - logic would go here to fetch from API if needed
    }
  };

  // Expose global
  window.ShopAIChat = ShopAIChat;
  
  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopAIChat.init());
  } else {
    ShopAIChat.init();
  }
})();
