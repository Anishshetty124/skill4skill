import React, { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { PaperAirplaneIcon, ArrowLeftIcon, TrashIcon, EllipsisVerticalIcon, XMarkIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { useSocketContext } from '../context/SocketContext';
import { toast } from 'react-toastify';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import ReportUserModal from '../components/common/ReportUserModal';
import MessagesPageSkeleton from '../components/messages/MessagePageSkeleton';

function useOnClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (event) => {
      if (!ref.current || ref.current.contains(event.target)) {
        return;
      }
      handler(event);
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

const ConversationList = ({ conversations, onSelectConversation, selectedConversation, onRefresh }) => (
  <div className="border-r border-slate-200 dark:border-slate-700 h-full flex flex-col bg-white dark:bg-slate-800">
    <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 flex justify-between items-center">
      <h2 className="text-xl font-bold">Messages</h2>
      <button onClick={onRefresh} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700" title="Refresh conversations">
        <ArrowPathIcon className="h-5 w-5" />
      </button>
    </div>
    <div className="overflow-y-auto flex-grow">
      {conversations.length > 0 ? conversations.map(conv => (
        <div 
          key={conv._id}
          onClick={() => onSelectConversation(conv.participant)}
          className={`p-4 flex items-center gap-4 cursor-pointer border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 ${selectedConversation?._id === conv.participant._id ? 'bg-slate-200 dark:bg-slate-700' : ''}`}
        >
          <img 
            src={conv.participant.profilePicture || `https://api.dicebear.com/8.x/initials/svg?seed=${conv.participant.firstName} ${conv.participant.lastName}`} 
            alt={conv.participant.username}
            className="w-12 h-12 rounded-full object-cover"
          />
          <div className="flex-grow">
            <p className="font-semibold">{conv.participant.firstName} {conv.participant.lastName}</p>
            <p className="text-sm text-slate-500">@{conv.participant.username}</p>
          </div>
          {conv.unreadCount > 0 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs text-white font-bold">
              {conv.unreadCount}
            </span>
          )}
        </div>
      )) : (
        <p className="p-4 text-sm text-slate-500">No conversations yet.</p>
      )}
    </div>
  </div>
);

const ChatWindow = ({ selectedConversation, onBack, onClearChat, onDeleteConversation, onReportUser }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const { socket } = useSocketContext();
  const messagesEndRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState(new Set());
  const menuRef = useRef();
  let pressTimer = useRef();

  useOnClickOutside(menuRef, () => setIsMenuOpen(false));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const getMessages = async () => {
      if (selectedConversation?._id && !selectedConversation._id.startsWith('new-')) {
        setLoading(true);
        try {
          const res = await apiClient.get(`/messages/${selectedConversation._id}`);
          setMessages(res.data.data);
        } catch (error) {
          console.error("Failed to fetch messages", error);
        } finally {
          setLoading(false);
        }
      } else {
        setMessages([]);
      }
    };
    getMessages();
  }, [selectedConversation]);

  useEffect(() => {
    const handleNewMessage = (newMessage) => {
      if (selectedConversation?._id === newMessage.senderId) {
        setMessages(prev => [...prev, newMessage]);
      }
    };
    
    const handleMessageDeleted = ({ messageId }) => {
        setMessages(prev => prev.filter(msg => msg._id !== messageId));
    };

    socket?.on("newMessage", handleNewMessage);
    socket?.on("messageDeleted", handleMessageDeleted);

    return () => {
        socket?.off("newMessage", handleNewMessage);
        socket?.off("messageDeleted", handleMessageDeleted);
    }
  }, [socket, selectedConversation, setMessages]);

  const handleMessageClick = (message) => {
    if (selectionMode && message.senderId === user._id) {
      const newSelection = new Set(selectedMessages);
      if (newSelection.has(message._id)) {
        newSelection.delete(message._id);
      } else {
        newSelection.add(message._id);
      }
      setSelectedMessages(newSelection);
      if (newSelection.size === 0) {
        setSelectionMode(false);
      }
    }
  };

  const handleDeleteSelected = async () => {
    const idsToDelete = Array.from(selectedMessages);
    if (window.confirm(`Are you sure you want to delete ${idsToDelete.length} message(s)?`)) {
      try {
        await Promise.all(idsToDelete.map(id => apiClient.delete(`/messages/message/${id}`)));
        setMessages(prev => prev.filter(msg => !idsToDelete.includes(msg._id)));
        toast.success("Message(s) deleted.");
      } catch (error) {
        toast.error("Failed to delete messages.");
      } finally {
        setSelectionMode(false);
        setSelectedMessages(new Set());
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    if (!selectedConversation?._id || selectedConversation._id.startsWith('new-')) {
        toast.error("Please wait a moment for the chat to be created before sending a message.");
        return;
    }

    const tempId = Date.now();
    const optimisticMessage = {
      _id: tempId,
      senderId: user._id,
      message: newMessage,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };

    setMessages(prev => [...prev, optimisticMessage]);
    setNewMessage("");

    try {
      const res = await apiClient.post(`/messages/send/${selectedConversation._id}`, { message: newMessage });
      setMessages(prev =>
        prev.map(msg => (msg._id === tempId ? { ...res.data.data, status: 'sent' } : msg))
      );
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to send message.");
      setMessages(prev =>
        prev.map(msg => (msg._id === tempId ? { ...msg, status: 'failed' } : msg))
      );
    }
  };

  const handleTouchStart = (message) => {
    if (message.senderId !== user._id) return;
    pressTimer.current = setTimeout(() => {
      setSelectionMode(true);
      setSelectedMessages(new Set([message._id]));
    }, 800);
  };

  const handleTouchEnd = () => {
    clearTimeout(pressTimer.current);
  };

  const handleContextMenu = (e, message) => {
    if (message.senderId !== user._id) return;
    e.preventDefault();
    setSelectionMode(true);
    setSelectedMessages(new Set([message._id]));
  };

  // --- NEW: Function to render date separators ---
  const renderMessagesWithDates = () => {
    let lastDate = null;
    return messages.map((msg, index) => {
        const messageDate = parseISO(msg.createdAt);
        const messageDay = format(messageDate, 'yyyy-MM-dd');
        let dateSeparator = null;

        if (messageDay !== lastDate) {
            lastDate = messageDay;
            let dateText = '';
            if (isToday(messageDate)) {
                dateText = 'Today';
            } else if (isYesterday(messageDate)) {
                dateText = 'Yesterday';
            } else {
                dateText = format(messageDate, 'MMMM d, yyyy');
            }
            dateSeparator = (
                <div key={`date-${messageDay}`} className="text-center my-4">
                    <span className="px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold rounded-full">
                        {dateText}
                    </span>
                </div>
            );
        }

        return (
            <React.Fragment key={msg._id}>
                {dateSeparator}
                <div 
                  className={`flex flex-col mb-4 ${msg.senderId === user._id ? 'items-end' : 'items-start'}`}
                  onClick={() => handleMessageClick(msg)}
                  onTouchStart={() => handleTouchStart(msg)}
                  onTouchEnd={handleTouchEnd}
                  onContextMenu={(e) => handleContextMenu(e, msg)}
                >
                  <div className={`px-4 py-2 rounded-2xl max-w-md relative transition-colors ${selectedMessages.has(msg._id) ? 'bg-blue-300 dark:bg-blue-900' : msg.senderId === user._id ? 'bg-blue-500 text-white' : 'bg-purple-300 dark:bg-purple-600'}`}>
                    {msg.message}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 px-2">
                    {format(messageDate, 'p')}
                  </p>
                </div>
            </React.Fragment>
        );
    });
  };
  
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-800">
      {/* Header */}
      {selectionMode ? (
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800 flex-shrink-0">
          <button onClick={() => { setSelectionMode(false); setSelectedMessages(new Set()); }}>
            <XMarkIcon className="h-6 w-6" />
          </button>
          <span className="font-bold">{selectedMessages.size} selected</span>
          <button onClick={handleDeleteSelected}>
            <TrashIcon className="h-6 w-6 text-red-500"/>
          </button>
        </div>
      ) : (
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800 flex-shrink-0">
          <div className="flex items-center gap-4">
              <button onClick={onBack} className="md:hidden p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700">
                  <ArrowLeftIcon className="h-6 w-6"/>
              </button>
              <Link to={`/profile/${selectedConversation.username}`} className="flex items-center gap-4">
                <img 
                src={selectedConversation.profilePicture || `https://api.dicebear.com/8.x/initials/svg?seed=${selectedConversation.firstName} ${selectedConversation.lastName}`} 
                alt={selectedConversation.username}
                className="w-10 h-10 rounded-full object-cover"
                />
                <p className="font-bold">{selectedConversation.firstName} {selectedConversation.lastName}</p>
              </Link>
          </div>
          <div className="relative" ref={menuRef}>
              <button onClick={() => setIsMenuOpen(prev => !prev)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700">
                  <EllipsisVerticalIcon className="h-6 w-6"/>
              </button>
              {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-md shadow-lg z-10 border dark:border-slate-700 divide-y dark:divide-slate-700">
                      <button onClick={() => { onClearChat(); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Clear Chat</button>
                      <button onClick={() => { onDeleteConversation(); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800">Delete Conversation</button>
                      <button onClick={() => { onReportUser(); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800">Report User</button>
                  </div>
              )}
          </div>
        </div>
      )}

      {/* Message List */}
      <div className="flex-1 p-4 overflow-y-auto">
        {loading && <p className="text-center">Loading messages...</p>}
        {!loading && renderMessagesWithDates()}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-shrink-0 bg-white dark:bg-slate-800">
        <input 
          type="text" 
          placeholder="Type a message..." 
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-full focus:outline-none"
        />
        <button type="submit" className="p-2 bg-blue-500 text-white rounded-full">
          <PaperAirplaneIcon className="h-6 w-6" />
        </button>
      </form>
    </div>
  );
};

// Main Page Component
const MessagesPage = () => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  
  const location = useLocation();
  const navigate = useNavigate();

  const { fetchUnreadCount } = useAuth();
  const { socket } = useSocketContext(); 	

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/messages/conversations');
      let fetchedConversations = response.data.data;

      const newChatUser = location.state?.newConversationWith;

      if (newChatUser) {
        const existingConv = fetchedConversations.find(c => c.participant._id === newChatUser._id);

        if (!existingConv) {
          const newConvPlaceholder = {
            _id: `new-${newChatUser._id}`,
            participant: newChatUser,
            unreadCount: 0
          };
          fetchedConversations = [newConvPlaceholder, ...fetchedConversations];
        }
        setSelectedConversation(newChatUser);
        navigate(location.pathname, { replace: true, state: {} });
      }

      setConversations(fetchedConversations);
      setError('');
    } catch (err) {
      setError('Failed to load conversations.');
    } finally {
      setLoading(false);
    }
  }, [location.state, navigate]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    const handleNewMessageUpdate = (newMessage) => {
        setConversations(prevConvs => {
            const convIndex = prevConvs.findIndex(c => c.participant._id === newMessage.senderId);
            if (convIndex === -1) {
                fetchConversations();
                return prevConvs;
            }
            const updatedConv = {
                ...prevConvs[convIndex],
                lastMessage: {
                    message: newMessage.message,
                    createdAt: newMessage.createdAt,
                },
                unreadCount: selectedConversation?._id !== newMessage.senderId 
                    ? (prevConvs[convIndex].unreadCount || 0) + 1 
                    : 0,
            };
            const otherConvs = prevConvs.filter(c => c.participant._id !== newMessage.senderId);
            return [updatedConv, ...otherConvs];
        });
        fetchUnreadCount();
    };

    socket?.on('newMessage', handleNewMessageUpdate);
    return () => {
      socket?.off('newMessage', handleNewMessageUpdate);
    };
  }, [socket, fetchConversations, selectedConversation, fetchUnreadCount]);


  const handleSelectConversation = useCallback(
    async (participant) => {
      setSelectedConversation(participant);
      const conv = conversations.find(c => c.participant._id === participant._id);

      if (conv && conv.unreadCount > 0) {
        try {
          await apiClient.post(`/messages/read/${participant._id}`);
          setConversations(prevConvs =>
            prevConvs.map(c =>
              c.participant._id === participant._id ? { ...c, unreadCount: 0 } : c
            )
          );
          fetchUnreadCount();
        } catch (error) {
          console.error('Failed to mark messages as read', error);
        }
      }
    },
    [conversations, fetchUnreadCount]
  );

  const handleClearChat = async () => {
    if (!selectedConversation || selectedConversation._id.startsWith('new-')) return;
    if (window.confirm('Are you sure you want to clear this entire chat history? This cannot be undone.')) {
      try {
        const conv = conversations.find(c => c.participant._id === selectedConversation._id);
        if (conv) {
          await apiClient.delete(`/messages/conversation/${conv._id}`);
          setSelectedConversation(prev => ({ ...prev })); 
          toast.success('Chat history cleared.');
        }
      } catch (error) {
        toast.error('Failed to clear chat.');
      }
    }
  };
 
  const handleDeleteConversation = async () => {
    if (!selectedConversation) return;
    
    const conv = conversations.find(c => c.participant._id === selectedConversation._id);
    if (!conv || conv._id.startsWith('new-')) {
        toast.error("Cannot delete a conversation that hasn't started.");
        return;
    }

    if (window.confirm("Are you sure you want to permanently delete this entire conversation? This cannot be undone.")) {
        try {
            await apiClient.delete(`/messages/conversation/${conv._id}/delete`);
            
            setConversations(prev => prev.filter(c => c._id !== conv._id));
            setSelectedConversation(null); 
            fetchUnreadCount();
            toast.success("Conversation deleted.");
        } catch (error) {
            toast.error("Failed to delete conversation.");
        }
    }
  };

  const handleReportUser = () => {
    if (!selectedConversation) return;
    setIsReportModalOpen(true);
  };

  if (loading) return <MessagesPageSkeleton />;
  if (error) return <p className="text-center p-10 text-red-500">{error}</p>;

  return (
    <div className="h-[calc(100vh-10rem)] md:h-[calc(100vh-12rem)] flex bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden">
      <div className={`flex-shrink-0 w-full md:w-1/3 ${selectedConversation ? 'hidden md:block' : 'block'}`}>
        <ConversationList
          conversations={conversations}
          onSelectConversation={handleSelectConversation}
          selectedConversation={selectedConversation}
          onRefresh={fetchConversations}
        />
      </div>

      <div className={`flex-1 ${selectedConversation ? 'block' : 'hidden md:block'}`}>
        {selectedConversation ? (
          <ChatWindow
            selectedConversation={selectedConversation}
            onBack={() => setSelectedConversation(null)}
            onClearChat={handleClearChat}
            onDeleteConversation={handleDeleteConversation}
            onReportUser={handleReportUser}
          />
          
        ) : (
          <div className="hidden md:flex flex-col items-center justify-center h-full text-center text-slate-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-24 w-24 mb-4 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <h3 className="text-xl font-semibold">Select a conversation</h3>
            <p>Choose from your existing conversations on the left to start chatting.</p>
          </div>
        )}
      </div>
      <ReportUserModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        reportedUser={selectedConversation}
        conversationId={conversations.find(c => c.participant._id === selectedConversation?._id)?._id}
      />
    </div>
    
  );
};

export default MessagesPage;