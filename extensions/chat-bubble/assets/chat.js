(function () {
  'use strict';

  const ShopAIChat = {
    state: {
      isOpen: false,
      isThinking: false,
      conversationId: sessionStorage.getItem('shopAiConversationId') || null,
      visitorId: sessionStorage.getItem('shopAiVisitorId') || null,
      emailCaptured: localStorage.getItem('shopAiEmailCaptured') === 'true',
      emailPopupShown: sessionStorage.getItem('shopAiEmailPopupShown') === 'true',
      chatHistory: JSON.parse(localStorage.getItem('shopAiChatHistory') || '[]'),
      cartId: null,
      checkoutUrl: null,
      selectedProduct: null,
      isCartUpdating: false,
      currentStage: 0
    },

    elements: {},

    init() {
      this.elements = {
        floatingGroup: document.getElementById('shop-ai-floating-group'),
        modal: document.getElementById('shop-ai-modal'),
        backdrop: document.getElementById('shop-ai-backdrop'),
        messages: document.getElementById('shop-ai-messages'),
        input: document.getElementById('shop-ai-input'),
        sendBtn: document.getElementById('shop-ai-send-btn'),
        closeBtn: document.getElementById('shop-ai-close-btn'),
        suggestions: document.getElementById('shop-ai-suggestions'),
        backBtn: document.getElementById('shop-ai-back-btn'),
        historyPanel: document.getElementById('shop-ai-history-panel'),
        historyList: document.getElementById('shop-ai-history-list')
      };

      if (!this.elements.modal) return;

      this.bindEvents();
      this.restoreState();
      this.exposeAPI();
    },

    bindEvents() {
      // Floating triggers
      document.querySelectorAll('[data-trigger]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.open();
        });
      });

      // Close handlers
      this.elements.closeBtn.addEventListener('click', () => this.close());
      this.elements.backdrop.addEventListener('click', () => this.close());

      // Input behavior
      this.elements.input.addEventListener('input', (e) => {
        this.adjustTextareaHeight();
        const hasText = e.target.value.trim().length > 0;
        this.elements.sendBtn.classList.toggle('active', hasText);
      });

      this.elements.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSubmit();
        }
        if (e.key === 'Escape') {
          this.close();
        }
      });

      this.elements.sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleSubmit();
      });

      // Back button
      this.elements.backBtn.addEventListener('click', () => {
        this.showSuggestions();
      });

      // Escape key handler
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const productModal = document.querySelector('.shop-ai-product-modal-overlay.active');
          if (productModal) {
            this.closeProductModal();
          } else if (this.state.isOpen) {
            this.close();
          }
        }
      });

      // Resize handling
      let resizeTimeout;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => this.adjustModalForContent(), 120);
      });
    },

    adjustTextareaHeight() {
      const textarea = this.elements.input;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    },

    exposeAPI() {
      window.ShopAIChat = this;
      if (!window.ShopAIChatAPI) window.ShopAIChatAPI = this;
    },

    restoreState() {
      // Check if we should show suggestions or existing conversation
      const hasMessages = this.elements.messages.querySelectorAll('.shop-ai-message').length > 0;
      if (!hasMessages) {
        this.elements.suggestions.classList.add('visible');
      }
    },

    open() {
      document.body.classList.add('shop-ai-open');
      if (this.elements.floatingGroup) this.elements.floatingGroup.classList.add('hidden');
      this.state.isOpen = true;
      
      setTimeout(() => this.elements.input.focus(), 320);
    },

    close() {
      document.body.classList.remove('shop-ai-open');
      if (this.elements.floatingGroup) this.elements.floatingGroup.classList.remove('hidden');
      this.state.isOpen = false;
      this.closeProductModal();
    },

    handleSubmit() {
      const message = this.elements.input.value.trim();
      if (!message || this.state.isThinking) return;

      this.send(message);
      this.elements.input.value = '';
      this.elements.input.style.height = 'auto';
      this.elements.sendBtn.classList.remove('active');
    },

    send(message) {
      // Hide suggestions
      this.elements.suggestions.classList.add('hidden');
      this.elements.backBtn.style.display = 'flex';

      // Add user message
      this.addUserMessage(message);

      // Start streaming
      this.startStream(message);
    },

    addUserMessage(content) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'shop-ai-message user';
      msgDiv.innerHTML = `
        <div class="shop-ai-message-content">
          <div class="shop-ai-message-header">${this.escapeHtml(content)}</div>
        </div>
      `;
      this.elements.messages.appendChild(msgDiv);
      this.scrollToBottom();
    },

    addAssistantMessage(content, options = {}) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'shop-ai-message assistant';
      
      let html = '<div class="shop-ai-message-content">';
      
      if (options.header) {
        html += `<div class="shop-ai-message-header">${this.escapeHtml(options.header)}</div>`;
      }
      
      html += `<div class="shop-ai-message-text">${this.parseMarkdown(content)}</div>`;
      
      if (options.showFeedback) {
        html += `
          <div class="shop-ai-feedback">
            <button class="shop-ai-feedback-btn" aria-label="Helpful">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
              </svg>
            </button>
            <button class="shop-ai-feedback-btn" aria-label="Not helpful">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
              </svg>
            </button>
          </div>
        `;
      }
      
      html += '</div>';
      msgDiv.innerHTML = html;
      
      this.elements.messages.appendChild(msgDiv);
      this.scrollToBottom();
      return msgDiv;
    },

    parseMarkdown(text) {
      if (!text || typeof text !== 'string') return '<p></p>';

      let html = text
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Links
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        // Line breaks
        .replace(/\n/g, '<br>');

      return `<p>${html}</p>`;
    },

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    showThinking() {
      if (this.state.isThinking) return;
      this.state.isThinking = true;

      const thinking = document.createElement('div');
      thinking.id = 'shop-ai-thinking';
      thinking.className = 'shop-ai-thinking';
      thinking.innerHTML = `
        <div class="shop-ai-thinking-dots">
          <div class="shop-ai-thinking-dot"></div>
          <div class="shop-ai-thinking-dot"></div>
          <div class="shop-ai-thinking-dot"></div>
        </div>
        <div class="shop-ai-thinking-text">Thinking...</div>
      `;

      this.elements.messages.appendChild(thinking);
      this.scrollToBottom();
      
      // Animate stages
      this.animateThinkingStages();
    },

    animateThinkingStages() {
      const stages = [
        'Thought about the question',
        'Curating available products...',
        'Preparing response...'
      ];
      
      let currentStage = 0;
      const textEl = document.querySelector('.shop-ai-thinking-text');
      
      const interval = setInterval(() => {
        if (!this.state.isThinking) {
          clearInterval(interval);
          return;
        }
        
        currentStage = (currentStage + 1) % stages.length;
        if (textEl) textEl.textContent = stages[currentStage];
      }, 1500);
      
      this.state.thinkingInterval = interval;
    },

    updateThinkingText(text) {
      const el = document.querySelector('.shop-ai-thinking-text');
      if (el) el.textContent = text;
    },

    removeThinking() {
      const thinking = document.getElementById('shop-ai-thinking');
      if (thinking) thinking.remove();
      
      if (this.state.thinkingInterval) {
        clearInterval(this.state.thinkingInterval);
      }
      
      this.state.isThinking = false;
    },

    showSuggestions() {
      this.elements.suggestions.classList.remove('hidden');
      this.elements.backBtn.style.display = 'none';
      
      // Remove all messages
      const messages = this.elements.messages.querySelectorAll('.shop-ai-message, .shop-ai-thinking, .shop-ai-product-section');
      messages.forEach(m => m.remove());
    },

    renderProducts(products, title = 'Products', subtitle = '') {
      if (!products || !products.length) return;

      const section = document.createElement('div');
      section.className = 'shop-ai-message assistant';
      
      let html = `
        <div class="shop-ai-message-content">
          <div class="shop-ai-product-section">
            <div class="shop-ai-product-header">${this.escapeHtml(title)}</div>
            ${subtitle ? `<div class="shop-ai-product-subheader">${this.escapeHtml(subtitle)}</div>` : ''}
            <div class="shop-ai-product-carousel">
      `;

      products.forEach(prod => {
        html += `
          <div class="shop-ai-product-card" onclick="ShopAIChat.openProductModal(${JSON.stringify(prod).replace(/"/g, '&quot;')})">
            <div class="shop-ai-product-image">
              <img src="${prod.image_url || ''}" alt="${this.escapeHtml(prod.title || 'Product')}" loading="lazy">
            </div>
            <div class="shop-ai-product-info">
              <div class="shop-ai-product-title">${this.escapeHtml(prod.title || 'Untitled')}</div>
              <div class="shop-ai-product-price">${prod.price || ''}</div>
            </div>
          </div>
        `;
      });

      html += `
            </div>
          </div>
        </div>
      `;
      
      section.innerHTML = html;
      this.elements.messages.appendChild(section);
      this.scrollToBottom();
    },

    openProductModal(product) {
      if (!product) return;
      this.state.selectedProduct = product;

      const existing = document.querySelector('.shop-ai-product-modal-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'shop-ai-product-modal-overlay active';
      overlay.innerHTML = `
        <div class="shop-ai-product-modal">
          <button class="shop-ai-product-modal-close" onclick="ShopAIChat.closeProductModal()" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <div class="shop-ai-product-modal-left">
            <img src="${product.image_url || ''}" alt="${this.escapeHtml(product.title || 'Product')}">
          </div>
          <div class="shop-ai-product-modal-right">
            <div class="shop-ai-product-modal-title">${this.escapeHtml(product.title || 'Untitled')}</div>
            <div class="shop-ai-product-modal-price">${product.price || ''}</div>
            
            ${product.options ? `
              <div class="shop-ai-product-modal-options">
                ${product.options.map(opt => `
                  <div class="shop-ai-option-row">
                    <span class="shop-ai-option-label">${this.escapeHtml(opt.name)}</span>
                    <span class="shop-ai-option-value">
                      ${this.escapeHtml(opt.value)}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6,9 12,15 18,9"></polyline>
                      </svg>
                    </span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            ${product.description ? `
              <div class="shop-ai-product-modal-description">${this.escapeHtml(product.description)}</div>
            ` : ''}
            
            <div class="shop-ai-product-modal-actions">
              <button class="shop-ai-btn shop-ai-btn-secondary" onclick="ShopAIChat.viewProduct('${product.url || ''}')">
                View
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 4px;">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15,3 21,3 21,9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </button>
              <button class="shop-ai-btn shop-ai-btn-primary" id="shop-ai-add-cart-btn" onclick="ShopAIChat.addToCart(${JSON.stringify(product).replace(/"/g, '&quot;')})">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      `;

      this.elements.modal.appendChild(overlay);
      
      // Show close button in header when modal is open
      this.elements.closeBtn.classList.add('visible');
    },

    closeProductModal() {
      const overlay = document.querySelector('.shop-ai-product-modal-overlay');
      if (overlay) overlay.remove();
      this.state.selectedProduct = null;
      this.elements.closeBtn.classList.remove('visible');
    },

    viewProduct(url) {
      if (url) {
        window.open(url, '_blank');
      }
    },

    async addToCart(product) {
      if (this.state.isCartUpdating) return;

      const variantId = product.variant_id || product.merchandise_id;
      if (!variantId) {
        this.addAssistantMessage('I could not find a valid variant for that item. Please use the product page to add it to your cart.');
        return;
      }

      this.state.isCartUpdating = true;
      const btn = document.getElementById('shop-ai-add-cart-btn');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle></svg> Adding...`;

      try {
        const result = await this.callCartApi({
          variantId,
          quantity: 1
        });

        if (result && result.checkoutUrl) {
          this.state.cartId = result.cartId || null;
          this.state.checkoutUrl = result.checkoutUrl;
          
          btn.classList.add('success');
          btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20,6 9,17 4,12"></polyline>
            </svg>
            Added to cart
          `;
          
          setTimeout(() => {
            btn.innerHTML = `
              Go to Cart
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 4px;">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12,5 19,12 12,19"></polyline>
              </svg>
            `;
            btn.onclick = () => this.openCheckout();
          }, 1500);
        } else {
          throw new Error('No checkout URL');
        }
      } catch (err) {
        console.error('Cart error:', err);
        btn.innerHTML = originalHTML;
        this.addAssistantMessage('I could not update your cart just now. Please try again or use the product page.');
      } finally {
        this.state.isCartUpdating = false;
      }
    },

    async callCartApi({ variantId, quantity }) {
      const cfg = window.shopChatConfig || {};
      const url = cfg.cartUrl || (cfg.apiUrl ? cfg.apiUrl.replace('/chat', '/api/cart') : null);

      if (!url) throw new Error('Cart API URL not configured');

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId,
          quantity: quantity || 1,
          cartId: this.state.cartId,
          conversationId: this.state.conversationId
        })
      });

      if (!resp.ok) throw new Error(`Cart API failed: ${resp.status}`);
      
      const data = await resp.json();
      return {
        cartId: data.cartId || null,
        checkoutUrl: data.checkoutUrl || null
      };
    },

    openCheckout() {
      if (this.state.checkoutUrl) {
        window.open(this.state.checkoutUrl, '_blank');
      }
    },

    async startStream(userMessage) {
      this.showThinking();

      try {
        const resp = await fetch(window.shopChatConfig.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMessage,
            conversation_id: this.state.conversationId,
            prompt_type: window.shopChatConfig.promptType || 'standardAssistant'
          })
        });

        if (!resp.ok) throw new Error('Network error');

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentContent = '';
        let currentMsgEl = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const chunk of parts) {
            const line = chunk.trim();
            if (!line) continue;
            
            const jsonStr = line.startsWith('data:') ? line.slice(5).trim() : line;
            let data;
            try { data = JSON.parse(jsonStr); } catch (err) { continue; }

            switch(data.type) {
              case 'id':
                if (data.conversation_id) {
                  this.state.conversationId = data.conversation_id;
                  sessionStorage.setItem('shopAiConversationId', data.conversation_id);
                }
                break;

              case 'tool_use':
                const toolText = data.tool_use_message || '';
                const shortText = toolText.includes('search') ? 'Searching products...' : 
                                 toolText.includes('cart') ? 'Updating cart...' : 
                                 'Scouting store...';
                this.updateThinkingText(shortText);
                break;

              case 'product_results':
                this.removeThinking();
                this.renderProducts(data.products || [], 'Snowboards In Stock', 'Ready for your next adventure!');
                break;

              case 'cart_updated':
                this.removeThinking();
                if (data.checkout_url) {
                  this.state.checkoutUrl = data.checkout_url;
                  if (data.cart?.id) this.state.cartId = data.cart.id;
                  this.addAssistantMessage(`Your cart is ready. You can [click here to proceed to checkout](${data.checkout_url}).`);
                }
                break;

              case 'chunk':
                if (this.state.isThinking) this.removeThinking();
                
                currentContent += data.chunk;
                
                if (!currentMsgEl) {
                  currentMsgEl = this.addAssistantMessage(currentContent, { showFeedback: true });
                } else {
                  const textEl = currentMsgEl.querySelector('.shop-ai-message-text');
                  if (textEl) textEl.innerHTML = this.parseMarkdown(currentContent);
                }
                this.scrollToBottom();
                break;

              case 'message_complete':
              case 'end_turn':
                this.removeThinking();
                currentMsgEl = null;
                currentContent = '';
                break;

              case 'error':
              case 'auth_required':
                this.removeThinking();
                this.addAssistantMessage(data.error || 'An error occurred');
                break;
            }
          }
        }

        this.removeThinking();
        
        // Add follow-up prompt
        if (!document.querySelector('.shop-ai-thinking')) {
          this.addAssistantMessage('Is there a particular style or feature you\'re looking for in a snowboard?', { showFeedback: true });
        }
        
      } catch (err) {
        console.error('Stream error:', err);
        this.removeThinking();
        this.addAssistantMessage('Sorry, there was an error. Please try again.');
      }
    },

    openHistory() {
      this.elements.historyPanel.classList.add('active');
      this.renderHistory();
    },

    closeHistory() {
      this.elements.historyPanel.classList.remove('active');
    },

    renderHistory() {
      if (!this.state.chatHistory.length) {
        this.elements.historyList.innerHTML = '<div style="text-align: center; padding: 40px; color: #6B7280;">No previous chats</div>';
        return;
      }

      this.elements.historyList.innerHTML = this.state.chatHistory
        .slice()
        .reverse()
        .map((chat, idx) => `
          <div class="shop-ai-history-item" onclick="ShopAIChat.loadChat(${this.state.chatHistory.length - 1 - idx})">
            <div class="shop-ai-history-content">
              <div class="shop-ai-history-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <div class="shop-ai-history-text">
                <div class="shop-ai-history-title">${this.escapeHtml(this.truncate(chat.title, 50))}</div>
                <div class="shop-ai-history-time">${this.formatTime(chat.timestamp)}</div>
              </div>
            </div>
            <div class="shop-ai-history-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9,18 15,12 9,6"></polyline>
              </svg>
            </div>
          </div>
        `)
        .join('');
    },

    loadChat(index) {
      const chat = this.state.chatHistory[index];
      if (!chat) return;

      this.closeHistory();
      this.elements.suggestions.classList.add('hidden');
      this.elements.backBtn.style.display = 'flex';
      
      // Clear current messages
      this.elements.messages.querySelectorAll('.shop-ai-message, .shop-ai-thinking').forEach(m => m.remove());
      
      // Replay messages
      if (chat.messages) {
        chat.messages.forEach(msg => {
          if (msg.role === 'user') {
            this.addUserMessage(msg.content);
          } else {
            this.addAssistantMessage(msg.content, { showFeedback: true });
          }
        });
      }
    },

    adjustModalForContent() {
      this.scrollToBottom();
    },

    scrollToBottom() {
      if (this.elements.messages) {
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
      }
    },

    truncate(text, length) {
      return text && text.length > length ? text.substring(0, length) + '...' : (text || '');
    },

    formatTime(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 1) return 'Just now';
      if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
      return date.toLocaleDateString();
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

  // Add spin animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
})();
