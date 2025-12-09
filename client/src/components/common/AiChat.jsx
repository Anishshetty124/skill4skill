import React, { useState, useRef, useEffect } from "react";
import {
  PaperAirplaneIcon,
  SparklesIcon,
  XMarkIcon,
  MicrophoneIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  UserIcon,
  CpuChipIcon,
  LightBulbIcon,
} from "@heroicons/react/24/solid";
import apiClient from "../../api/axios";
import ReactMarkdown from "react-markdown";
import { useAuth } from "../../context/AuthContext";

const SUGGESTIONS = [
  "Create a learning roadmap for...",
  "Explain this code snippet...",
  "Interview questions for React",
  "How do I optimize this?",
];

const AiChat = () => {
  const { chatMessages, updateChatMessages } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  
  // Refs
  const inputRef = useRef(""); 
  const textInputRef = useRef(null); 
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const chatWindowRef = useRef(null);
  const toggleButtonRef = useRef(null);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);

  // 1. CLICK OUTSIDE TO CLOSE
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        isOpen &&
        chatWindowRef.current &&
        !chatWindowRef.current.contains(event.target) &&
        !toggleButtonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Focus Logic
  useEffect(() => {
    if (isOpen && textInputRef.current) {
      setTimeout(() => textInputRef.current.focus(), 50); 
    }
  }, [isOpen]);

  // Sync ref for speech
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  // Speech Recognition Setup
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (inputRef.current ? inputRef.current + " " : "") + transcript);
      setIsListening(false);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(scrollToBottom, [chatMessages, isLoading]);

  const handleSend = async (e, textOverride = null) => {
    if (e) e.preventDefault();
    const query = textOverride || input;
    if (!query.trim() || isLoading) return;

    const userMessage = { sender: "user", text: query };
    updateChatMessages((prev) => [...prev, userMessage]);

    setInput("");
    setIsLoading(true);
    textInputRef.current?.focus(); 

    const history = chatMessages.map((msg) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    }));

    try {
      const response = await apiClient.post("/skills/ai-generate", {
        context: "ask-ai",
        query: query,
        history: history,
      });
      const aiMessage = { sender: "ai", text: response.data.data.response };
      updateChatMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage = {
        sender: "ai",
        text: error.response?.data?.message || "Connection failed. Please try again.",
      };
      updateChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleMicClick = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        ref={toggleButtonRef}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`fixed bottom-6 right-6 p-4 rounded-full shadow-2xl z-40 transition-all duration-300 hover:scale-110 group ${
          isOpen ? "bg-red-500 rotate-90" : "bg-gradient-to-r from-violet-600 to-indigo-600"
        }`}
      >
        {/* CHANGED: Replaced 'animate-ping' with 'animate-pulse' and subtle opacity */}
        {!isOpen && <span className="absolute inset-0 rounded-full animate-pulse bg-violet-400 opacity-40"></span>}
        
        {isOpen ? <XMarkIcon className="h-7 w-7 text-white" /> : <SparklesIcon className="h-7 w-7 text-white" />}
      </button>

      {/* Main Chat Window */}
      {isOpen && (
        <div 
          ref={chatWindowRef}
          className="fixed bottom-24 right-4 md:right-6 w-[95%] max-w-[400px] h-[75vh] max-h-[700px] flex flex-col z-50 rounded-3xl shadow-2xl border border-white/20 overflow-hidden font-sans animate-fade-in-up backdrop-blur-xl bg-white/90 dark:bg-slate-900/90 supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-slate-900/60"
        >
          
          {/* Header */}
          <div className="p-4 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border-b border-gray-200 dark:border-slate-700 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-tr from-violet-500 to-fuchsia-500 rounded-lg">
                <CpuChipIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white text-sm leading-tight">Skill Assistant</h3>
                <p className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Online
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateChatMessages([])}
                className="text-xs font-medium text-slate-500 hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                Clear
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-1 p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600">
            
            {/* Suggestions */}
            {chatMessages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
                <div className="p-4 bg-gradient-to-tr from-violet-100 to-indigo-100 dark:from-slate-800 dark:to-slate-700 rounded-full">
                  <LightBulbIcon className="h-8 w-8 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-semibold text-slate-700 dark:text-slate-200">Hello! I'm ready to help.</h4>
                  <p className="text-xs text-slate-500 max-w-[200px] mx-auto">Ask me about coding, debugging, or career paths.</p>
                </div>
                
                <div className="flex flex-wrap justify-center gap-2 max-w-[280px]">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={(e) => handleSend(e, s)}
                      className="text-[10px] md:text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-violet-500 dark:hover:border-violet-400 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-full transition-all hover:shadow-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-6">
              {chatMessages.map((msg, index) => (
                <div key={index} className={`flex gap-3 ${msg.sender === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${msg.sender === "user" ? "bg-blue-100 text-blue-600" : "bg-violet-100 text-violet-600"}`}>
                    {msg.sender === "user" ? <UserIcon className="h-5 w-5" /> : <CpuChipIcon className="h-5 w-5" />}
                  </div>

                  <div className={`relative group max-w-[85%] rounded-2xl px-4 py-3 shadow-sm text-sm leading-relaxed ${
                    msg.sender === "user" 
                      ? "bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-tr-none" 
                      : "bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-tl-none"
                  }`}>
                    <ReactMarkdown 
                      components={{
                        code: ({node, ...props}) => <span className="font-mono bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-[11px]" {...props} />,
                        pre: ({node, ...props}) => <div className="overflow-x-auto bg-slate-900 text-slate-100 p-3 rounded-lg my-2 text-xs font-mono" {...props} />
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>

                    {msg.sender === "ai" && (
                      <button 
                        onClick={() => handleCopy(msg.text, index)}
                        className="absolute -bottom-5 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-slate-400 hover:text-violet-500"
                      >
                        {copiedIndex === index ? (
                          <><CheckIcon className="h-3 w-3" /> Copied</>
                        ) : (
                          <><ClipboardDocumentIcon className="h-3 w-3" /> Copy</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                    <CpuChipIcon className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area */}
          <div className="p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-t border-slate-200 dark:border-slate-700">
            <form onSubmit={(e) => handleSend(e)} className="relative flex items-center gap-2">
              <div className="relative flex-grow">
                <input
                  ref={textInputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isListening ? "Listening..." : "Type a message..."}
                  className="w-full pl-4 pr-10 py-3 text-sm bg-slate-100 dark:bg-slate-800 border-none rounded-2xl focus:ring-2 focus:ring-violet-500 dark:text-white placeholder:text-slate-400 transition-all shadow-inner"
                  disabled={isLoading}
                />
                
                {recognitionRef.current && (
                  <button
                    type="button"
                    onClick={handleMicClick}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-all ${
                      isListening ? "bg-red-100 text-red-500 animate-pulse" : "hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"
                    }`}
                  >
                    <MicrophoneIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
              
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl shadow-lg shadow-violet-200 dark:shadow-none hover:shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100"
              >
                <PaperAirplaneIcon className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default AiChat;