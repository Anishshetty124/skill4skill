import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../api/axios';
import ProposalCard from '../components/dashboard/ProposalCard';
import ChatRequestCard from '../components/dashboard/ChatRequestCard';
import ProposalCardSkeleton from '../components/dashboard/ProposalCardSkeleton';
import { useSocketContext } from '../context/SocketContext';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import { 
  InboxArrowDownIcon, 
  PaperAirplaneIcon, 
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';

const Dashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const { socket } = useSocketContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(location.state?.defaultTab || 'received_proposals');

  // --- Fetch Logic (Kept exactly as original) ---
  const fetchData = useCallback(async () => {
    setLoading(true);
    setData([]);
    try {
      let response;
      if (activeTab === 'chat_requests') {
        response = await apiClient.get('/chat-requests');
      } else {
        const type = activeTab === 'sent_proposals' ? 'sent' : 'received';
        response = await apiClient.get(`/proposals?type=${type}`);
      }

      const validData = (response.data.data || [])
        .filter(item => !item.archivedBy?.includes(user?._id))
        .filter(item => activeTab.includes('proposal') ? item.requestedSkill : true);

      setData(validData);
    } catch (error) {
      console.error('Failed to fetch data', error);
      toast.error('Could not load dashboard items.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, user?._id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Socket Logic (Kept exactly as original) ---
  useEffect(() => {
    const handleUpdate = () => fetchData();
    socket?.on('swap_completed', handleUpdate);
    socket?.on('new_notification', handleUpdate);
    socket?.on('new_chat_request', handleUpdate);
    return () => {
      socket?.off('swap_completed', handleUpdate);
      socket?.off('new_notification', handleUpdate);
      socket?.off('new_chat_request', handleUpdate);
    };
  }, [socket, fetchData]);

  const handleProposalUpdate = (updatedProposal) => {
    setData(prevData =>
      prevData.map(item =>
        item._id === updatedProposal._id ? updatedProposal : item
      )
    );
  };

  const handleRespondToRequest = async (request, status) => {
    try {
      await apiClient.patch(`/chat-requests/${request._id}/respond`, { status });
      toast.success(`Request ${status}.`);
      setData(prev =>
        prev.map(req =>
          req._id === request._id ? { ...req, status } : req
        )
      );
    } catch (error) {
      toast.error('Failed to respond to request.');
    }
  };

  const handleDeleteItem = async (item) => {
    const isProposal = activeTab.includes('proposal');
    const endpoint = isProposal ? `/proposals/${item._id}` : `/chat-requests/${item._id}`;

    if (window.confirm('Are you sure you want to permanently delete this item?')) {
      try {
        await apiClient.delete(endpoint);
        setData(prev => prev.filter(i => i._id !== item._id));
        toast.success('Item deleted.');
      } catch (error) {
        toast.error('Failed to delete item.');
      }
    }
  };

  // --- UI Components ---

  const TabButton = ({ id, label, icon: Icon }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`
        relative flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 px-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 w-full
        ${activeTab === id 
          ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-md ring-1 ring-black/5 dark:ring-white/10' 
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
        }
      `}
    >
      <Icon className={`h-5 w-5 ${activeTab === id ? 'text-violet-600 dark:text-violet-400' : ''}`} />
      <span>{label}</span>
    </button>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
             <ProposalCardSkeleton key={i} />
          ))}
        </div>
      );
    }

    if (data.length === 0) {
      const emptyState = {
        received_proposals: { text: 'No proposals received yet.', sub: "Wait for others to find your skills!", icon: InboxArrowDownIcon },
        sent_proposals: { text: "You haven't sent any proposals.", sub: "Go explore skills and propose a swap!", icon: PaperAirplaneIcon },
        chat_requests: { text: 'No message requests.', sub: "Your inbox is all caught up.", icon: ChatBubbleLeftRightIcon },
      };
      const { text, sub, icon: Icon } = emptyState[activeTab];

      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-3xl border border-dashed border-slate-300 dark:border-slate-700">
          <div className="p-4 bg-slate-100 dark:bg-slate-700 rounded-full mb-4">
            <Icon className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">{text}</h3>
          <p className="text-sm text-slate-500 mt-1">{sub}</p>
        </div>
      );
    }

    // --- Render Items ---
    return (
      <div className="space-y-4">
        {data.map(item => {
          // Chat Requests
          if (activeTab === 'chat_requests') {
            if (!item.requester || !item.receiver) return null;
            const type = item.requester._id === user._id ? 'sent' : 'received';
            return (
              <div key={item._id} className="transition-all duration-300 hover:scale-[1.01]">
                <ChatRequestCard
                  request={item}
                  type={type}
                  onRespond={handleRespondToRequest}
                  onDelete={() => handleDeleteItem(item)}
                />
              </div>
            );
          }

          // Proposals (Sent & Received)
          const isSent = activeTab === 'sent_proposals';
          return (
            <div key={item._id} className="transition-all duration-300 hover:scale-[1.01]">
              <ProposalCard
                proposal={item}
                type={isSent ? "sent" : "received"}
                onUpdate={handleProposalUpdate}
                onActionComplete={fetchData}
                onDelete={() => handleDeleteItem(item)}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-12">
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-200/30 dark:bg-violet-900/20 rounded-full blur-3xl" />
        <div className="absolute top-20 right-1/4 w-72 h-72 bg-blue-200/30 dark:bg-blue-900/20 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Header Section */}
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Dashboard
          </h1>
          <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400">
            Manage your skill swaps and incoming requests.
          </p>
        </div>

        {/* Navigation Tabs - Grid Layout Fix for Mobile */}
        <div className="mb-8 sticky top-4 z-30">
          <div className="bg-slate-200/80 dark:bg-slate-800/80 backdrop-blur-md p-1.5 rounded-2xl shadow-sm">
            {/* GRID LAYOUT: Forces 3 columns so nothing is hidden off-screen */}
            <div className="grid grid-cols-3 gap-1 sm:gap-2">
              <TabButton 
                id="received_proposals" 
                label="Received" 
                icon={InboxArrowDownIcon} 
              />
              <TabButton 
                id="sent_proposals" 
                label="Sent" 
                icon={PaperAirplaneIcon} 
              />
              <TabButton 
                id="chat_requests" 
                label="Requests" 
                icon={ChatBubbleLeftRightIcon} 
              />
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="relative z-10 min-h-[400px]">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;