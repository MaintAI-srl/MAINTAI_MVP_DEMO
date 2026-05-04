"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { MessageCircle, X, Send, Bot, User, Minus, Maximize2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function GuideBot() {
  const { isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ciao! Sono Felix, la tua guida in MaintAI. Come posso aiutarti oggi?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen, isMinimized]);

  if (!isAuthenticated) return null;

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      // Prepariamo la cronologia per il backend
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: userMsg });

      const res = await apiPost<{ content: string }>("/guide/chat", { messages: history });
      setMessages(prev => [...prev, { role: "assistant", content: res.content }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Scusa, ho avuto un problema tecnico. Riprova tra poco." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end">
      {/* Chat Window */}
      {isOpen && (
        <div className={`mb-4 w-80 md:w-96 bg-[#0a0f1e]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ${isMinimized ? 'h-14' : 'h-[500px]'}`}>
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                <Bot size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide">FELIX GUIDE</h3>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[10px] text-emerald-400 font-medium uppercase tracking-tighter">Online</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 transition-colors"
              >
                {isMinimized ? <Maximize2 size={16} /> : <Minus size={16} />}
              </button>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-lg text-gray-400 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          {!isMinimized && (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                      m.role === "user" 
                        ? "bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-900/20" 
                        : "bg-white/5 border border-white/10 text-gray-200 rounded-tl-none"
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 p-3 rounded-2xl rounded-tl-none">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"></span>
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input Area */}
              <div className="p-4 bg-black/20 border-t border-white/5">
                <div className="relative">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    placeholder="Chiedimi aiuto..."
                    className="w-100% w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-4 pr-12 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || loading}
                    className="absolute right-1.5 top-1.5 p-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg transition-all"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        className={`group relative flex items-center justify-center w-14 h-14 rounded-full shadow-2xl transition-all duration-500 transform hover:scale-110 active:scale-95 ${
          isOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"
        }`}
      >
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-full bg-blue-500 blur-md opacity-40 group-hover:opacity-70 transition-opacity animate-pulse"></div>
        
        {/* Main button */}
        <div className="relative w-full h-full rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center border border-white/20">
          <MessageCircle className="text-white group-hover:rotate-12 transition-transform" />
          
          {/* Badge */}
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-[#0a0f1e] rounded-full"></span>
        </div>
      </button>
    </div>
  );
}
