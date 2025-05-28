'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getGameStateAction, initiateBiddingAction } from '../actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useSocket } from '@/contexts/SocketContext';
import { ROUND_DISTRIBUTION } from '@/lib/game/round';
import React from 'react';
import { Slider } from "@/components/ui/slider";

// Placeholder for AuthContext - Replace with your actual AuthContext import and implementation
// Made this stable for the example. Ensure your real useAuth provides stable references or primitives.
// const stableAuthData = { userId: 1, isAuthenticated: true }; 
// const useAuth = () => stableAuthData;

// Client-side interfaces (assuming these are correct)
interface Card { suit: string; rank: string; }
interface PlayerInGame { id: number; userId: number; userName: string; userEmail: string; playerOrder: number; currentScore: number; currentBid: number | null; hand?: Card[]; }
interface GameStateForClient {
  id: number; 
  gameName: string | null;
  status: string; 
  currentRound: number | null; 
  trumpSuit: string | null; 
  currentDealerId: number | null; 
  currentTurnGamePlayerId: number | null; 
  players: PlayerInGame[]; 
  requestingUserId?: number; 
  currentTrickPlays?: { gamePlayerId: number; userName: string; cardSuit: string; cardRank: string; playSequenceInTrick: number }[];
  allCompletedTricksInCurrentRound?: Array<{
    trickNumberInRound: number;
    winningGamePlayerId: number;
    winnerName: string;
    cards: Array<{
      gamePlayerId: number;
      playerName: string;
      cardSuit: string;
      cardRank: string;
      playSequenceInTrick: number;
    }>;
  }>;
  roundSummaryData?: Array<{
    roundNumber: number;
    playerRoundDetails: Array<{
      gamePlayerId: number;
      playerName: string;
      scoreChange: number;
      cumulativeScoreAfterRound: number;
    }>;
  }>;
}
type GameStateActionResult = | { success: true; gameState: GameStateForClient; error?: undefined } | { success?: undefined; gameState?: undefined; error: string };

// Helper function to get first name
const getFirstName = (fullName: string | null | undefined): string => {
  if (!fullName) return 'Speler'; // Fallback for missing names
  return fullName.split(' ')[0];
};

export default function GamePage() {
  const params = useParams();
  const router = useRouter(); // Generally stable
  const gameId = parseInt(params.gameId as string, 10); // Primitive, stable if params.gameId is stable
  const { socket } = useSocket(); // Assuming stable from context
  // const { userId: globalCurrentUserId } = useAuth(); // Now stable due to placeholder change
  const [clientSideUserId, setClientSideUserId] = useState<number | null>(null);

  const [gameState, setGameState] = useState<GameStateForClient | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBidAmount, setCurrentBidAmount] = useState<number | string>('0');
  const [isSubmittingBid, setIsSubmittingBid] = useState(false);
  const [biddingInitiationAttempted, setBiddingInitiationAttempted] = useState(false);
  const [showRoundSummaryModal, setShowRoundSummaryModal] = useState(false);

  // Define myTurn and meAsPlayer earlier
  const myTurn = gameState?.players && clientSideUserId && gameState.currentTurnGamePlayerId
    ? gameState.players.find(p => p.id === gameState.currentTurnGamePlayerId)?.userId === clientSideUserId
    : false;
  const meAsPlayer = gameState?.players
    ? gameState.players.find(p => p.userId === clientSideUserId)
    : undefined;

  const myWonTricksThisRound = gameState?.allCompletedTricksInCurrentRound?.filter(
    trick => trick.winningGamePlayerId === meAsPlayer?.id
  ) || [];

  const handlePlayCard = useCallback((card: Card) => {
    if (!socket) {
      toast.error('Socket niet verbonden.');
      return;
    }
    if (!gameState) {
      toast.error('Spelstatus niet beschikbaar.');
      return;
    }
    if (gameState.status !== 'active_play') {
      toast.error('Niet in de kaartspeelfase.');
      return;
    }
    if (!myTurn) {
      toast.error('Niet jouw beurt om te spelen.');
      return;
    }
    if (!meAsPlayer) {
      toast.error('Spelerinformatie niet gevonden.');
      return;
    }

    socket.emit('playCard', {
      gameId: gameState.id,
      gamePlayerId: meAsPlayer.id, // This is gamePlayer.id
      card: { suit: card.suit, rank: card.rank }
    });
    // Optional: optimistic UI update or loading state for card play
    toast.info(`Bezig met spelen van ${card.rank} ${card.suit}...`);
  }, [socket, gameState, myTurn, meAsPlayer]);

  const fetchGameState = useCallback(async () => {
    // // console.log("[Debug] fetchGameState called for gameId:", gameId);
    if (!gameId || isNaN(gameId)) {
      // console.log("[Debug] fetchGameState: gameId is null, returning.");
      setError('Ongeldig spel-ID.');
      console.warn(`[P1DEBUG fetchGameState] Invalid gameId: ${gameId}`);
      return; // setIsLoading is handled by the caller's finally block
    }

    const formData = new FormData();
    formData.append('gameId', gameId.toString());

    try {
      const result = await getGameStateAction(null as any, formData) as GameStateActionResult;
      // // console.log("[Debug] fetchGameState ACTION RESULT] GameID: ${gameId}, Result: ${JSON.stringify(result)}");

      if (result.error) {
        // console.error("[Debug] fetchGameState ERROR from action] GameID: ${gameId}, Error: ${result.error}");
        setError(result.error);
        console.error(`[P1DEBUG fetchGameState ERROR from action] GameID: ${gameId}, Error: ${result.error}`);
        if (result.error.includes('lobby')) {
            toast.info('Spel is nog in de lobby. Doorverwijzen...');
            router.push(`/game/${gameId}/lobby`);
        } else if (result.error.includes('ended')) {
            toast.info('Dit spel is beëindigd. Geen actieve status beschikbaar.');
        }
      } else if (result.success && result.gameState) {
        setGameState(result.gameState); 
        setError(null);
        if (result.gameState.requestingUserId) {
            console.log(`[P1DEBUG fetchGameState SUCCESS] GameID: ${gameId}, Setting clientSideUserId to: ${result.gameState.requestingUserId}`);
            setClientSideUserId(result.gameState.requestingUserId);
            const me = result.gameState.players.find(p => p.userId === result.gameState.requestingUserId);
            if (me && me.hand) {
                // console.log(`[fetchGameState] Initial hand for user ${result.gameState.requestingUserId} received.`);
            } else {
                // console.warn(`[fetchGameState] Initial hand for user ${result.gameState.requestingUserId} NOT found...`);
            }
        } else {
            console.warn(`[P1DEBUG fetchGameState WARNING] GameID: ${gameId}, gameState received but no requestingUserId.`);
        }
      } else {
        const unknownError = 'Ophalen spelstatus mislukt door onverwachte serverreactie.';
        setError(unknownError);
        toast.error(unknownError);
        console.error(`[P1DEBUG fetchGameState UNKNOWN OUTCOME] GameID: ${gameId}, Result: ${JSON.stringify(result)}`);
      }
    } catch (e: any) {
      const clientError = 'Onverwachte client-fout bij ophalen speldata.';
      setError(clientError);
      toast.error(clientError);
      console.error(`[P1DEBUG fetchGameState CATCH EXCEPTION] GameID: ${gameId}, Error:`, e);
    } 
  }, [gameId, router, clientSideUserId]); // Added clientSideUserId here for the entry log context

  // Effect for Initial Data Fetch when gameId or user changes
  useEffect(() => {
    console.log(`[P1DEBUG Initial Fetch useEffect] GameID: ${gameId}, Current clientSideUserId: ${clientSideUserId}. Setting isLoading true.`);
    setIsLoading(true);
    fetchGameState().finally(() => {
      console.log(`[P1DEBUG Initial Fetch useEffect FINALLY] GameID: ${gameId}, Current clientSideUserId: ${clientSideUserId}. Setting isLoading false.`);
      setIsLoading(false);
    });
  }, [gameId, fetchGameState]); // fetchGameState dependency is important. clientSideUserId is not added here to prevent potential loops if fetchGameState modifies it.

  // Effect for Polling Game State
  useEffect(() => {
    let intervalId: NodeJS.Timeout | undefined = undefined;

    if (gameState && (gameState.status === 'active' || gameState.status === 'bidding') && !isSubmittingBid && !isLoading) {
      // console.log("Setting up polling interval. Current status:", gameState.status);
      intervalId = setInterval(() => {
        if (!document.hidden) { 
          console.log(`[P1DEBUG Polling Interval] GameID: ${gameId}, Current clientSideUserId: ${clientSideUserId}. Calling fetchGameState.`);
          fetchGameState(); 
        }
      }, 10000);
    } else {
      // console.log("Polling conditions not met...");
    }
    
    return () => {
      if (intervalId) {
        // console.log("Clearing polling interval.");
        clearInterval(intervalId);
      }
    };
  }, [gameState?.status, isSubmittingBid, isLoading, fetchGameState]); // Depends on status to decide, and isLoading to avoid polling during initial load

  // Socket handling useEffect (seems okay, depends on stable globalCurrentUserId)
  useEffect(() => {
    if (socket && gameId && clientSideUserId !== null) {
      socket.emit('joinGameRoom', gameId.toString());
      // console.log(\`Socket \${socket.id} (User \${clientSideUserId}) joined room \${gameId}\`); // Less critical

      const handleGameStateUpdate = (newGameState: GameStateForClient) => {
        // console.log("[Client-side gameState Update] Received from server:", newGameState);
        if (newGameState.status === 'round_summary') {
          console.log("ROUND SUMMARY MODAL TRIGGERED. Received newGameState:", JSON.stringify(newGameState, null, 2));
        }
        setGameState(newGameState);
        
        // Handle round summary modal visibility
        if (newGameState.status === 'round_summary' && newGameState.roundSummaryData && newGameState.roundSummaryData.length > 0) {
          setShowRoundSummaryModal(true);
        } else {
          setShowRoundSummaryModal(false); // Hide if not in summary or no data
        }

        if (clientSideUserId) {
            const meInNewState = newGameState.players.find(p => p.userId === clientSideUserId);
            if (meInNewState && meInNewState.hand && meInNewState.hand.length > 0) {
                // console.log(`LOG Verify: [handleGameStateUpdate] Hand for user ${clientSideUserId} is present...`); // Less critical now hand display works
            } else if (meInNewState) {
                // console.warn(`LOG Verify: [handleGameStateUpdate] Hand for user ${clientSideUserId} is MISSING...`); // Keep warnings
            } else {
                //  console.warn(`LOG Verify: [handleGameStateUpdate] User ${clientSideUserId} NOT FOUND...`); // Keep warnings
            }
        }
        
        setIsSubmittingBid(false); 
        setCurrentBidAmount('0');
        // toast.success(`Game state updated (via broadcast).`); // Can be noisy if frequent
      };

      const handleActionError = (errorData: { message: string }) => {
        // console.error('Received actionError from server:', errorData.message); // Keep errors
        toast.error(errorData.message);
        setIsSubmittingBid(false);
      };

      const handleBidSuccess = (data: { message: string, gameId: number }) => {
        // console.log('Received bidSuccess from server:', data.message); // Less critical
        toast.success(data.message); 
        setIsSubmittingBid(false);
      };

      socket.on('gameStateUpdate', handleGameStateUpdate);
      socket.on('actionError', handleActionError);
      socket.on('bidSuccess', handleBidSuccess);

      return () => {
        // // console.log("[Debug] GamePage useEffect cleanup: Removing listeners for gameId:", gameId);
        socket.off('gameStateUpdate', handleGameStateUpdate);
        socket.off('actionError', handleActionError);
        socket.off('bidSuccess', handleBidSuccess);
      };
    }
  }, [socket, gameId, clientSideUserId]);

  // Initiate Bidding useEffect (seems okay)
  useEffect(() => {
    if (gameState && gameState.status === 'active' && gameState.currentRound === 1 && !biddingInitiationAttempted && clientSideUserId !== null) {
      setBiddingInitiationAttempted(true);
      // console.log(`Game ${gameId} is active for round 1 (User ${clientSideUserId}). Attempting to initiate bidding...`); // Less critical
      const formData = new FormData();
      formData.append('gameId', gameId.toString());
      initiateBiddingAction(null as any, formData)
        .then((result: { success?: string; error?: string }) => {
          if (result.error) {
            // console.error('Failed to initiate bidding:', result.error); // Keep errors
            toast.error(`Starten met bieden mislukt: ${result.error}`);
            setBiddingInitiationAttempted(false); 
          } else if (result.success) {
            // console.log('Bidding initiated successfully:', result.success); // Less critical
            toast.success(result.success); 
          }
        })
        .catch(e => {
          // console.error('Client-side error initiating bidding:', e);
          toast.error('Onverwachte fout bij starten biedproces.');
          setBiddingInitiationAttempted(false); 
        });
    }
  }, [gameState?.status, gameState?.currentRound, gameId, biddingInitiationAttempted, clientSideUserId]); // gameState.status and .currentRound are more specific

  // UI update for bid input based on game state (seems okay)
  useEffect(() => {
    if (!gameState) { 
      setCurrentBidAmount('0'); // Reset to "0"
      setIsSubmittingBid(false); 
      return;
    }
    if (gameState.status !== 'bidding' || !myTurn) {
        setCurrentBidAmount('0'); // Reset to "0"
    } else if (gameState.status === 'bidding' && myTurn && meAsPlayer?.currentBid === null) {
        setIsSubmittingBid(false);
    }
  }, [gameState?.status, myTurn, meAsPlayer?.currentBid]); // gameState.status specific

  // Logic for cardsForBiddingUI, moved before return, only calculate if bidding
  let cardsForBiddingUI: number | undefined = undefined;
  if (gameState && gameState.status === 'bidding' && gameState.currentRound !== null) {
    const roundIndex = gameState.currentRound - 1;
    if (roundIndex >= 0 && roundIndex < ROUND_DISTRIBUTION.length) {
      cardsForBiddingUI = ROUND_DISTRIBUTION[roundIndex];
    } else {
      console.error("Bidding UI: Invalid currentRound from gameState:", gameState.currentRound); // Keep errors
    }
  }
  
  // Early returns
  if (clientSideUserId === null && isLoading) { // Show loading if user ID isn't set yet AND we are in initial load phase
    return <div className="container mx-auto p-4">Gebruiker identificeren en spelstatus laden...</div>;
  }
  if (clientSideUserId === null && !isLoading && error) { // If loading finished but user ID is null and there's an error
    return <div className="container mx-auto p-4">Kon gebruiker niet identificeren of spel laden: {error}. Gelieve te vernieuwen.</div>;
  }
   if (clientSideUserId === null && !isLoading) { // If loading finished, no error, but still no user ID (e.g. action failed silently to provide it)
    return <div className="container mx-auto p-4">Kon gebruiker niet identificeren. Gelieve te vernieuwen of inlogstatus te controleren.</div>;
  }
  if (isLoading && !gameState && clientSideUserId !== null) { // This covers general loading after user ID is identified but before gameState is set
    return <div className="container mx-auto p-4">Spelstatus laden...</div>;
  }
  
  const handleBidSubmit = () => {
    if (!socket || !gameState || !meAsPlayer || gameState.currentRound === null) {
      toast.error("Kan bod niet indienen: Kritieke informatie ontbreekt of ronde niet actief.");
      return;
    }
    const bidVal = parseInt(currentBidAmount as string, 10);
    const maxBid = meAsPlayer.hand?.length ?? 0;

    if (isNaN(bidVal) || bidVal < 0 || bidVal > maxBid) {
      toast.error(`Ongeldig bod. Moet tussen 0 en ${maxBid} zijn.`);
      return;
    }

    setIsSubmittingBid(true);
    console.log(`[Client GamePage] Submitting bid for gPId ${meAsPlayer.id}: ${bidVal} for game ${gameState.id} round ${gameState.currentRound}`);
    socket.emit('submitBid', {
      gameId: gameState.id,
      gamePlayerId: meAsPlayer.id, // This is gamePlayer.id
      bidAmount: bidVal,
      roundNumber: gameState.currentRound,
    });
    // Optimistically set currentBidAmount to empty, actual state update via broadcast
    // setCurrentBidAmount(''); 
    // Server will set isSubmittingBid to false on broadcast or error
  };

  // Define the type for the initiateBiddingAction result more precisely
  type InitiateBiddingActionResult = 
    | { success: string; error?: undefined }
    | { error: string; success?: undefined };

  const handleInitiateBidding = async () => {
    if (!gameState || gameState.id === null || !meAsPlayer ) {
        toast.error("Kan bieden niet starten: Spel- of spelerinformatie ontbreekt.");
        return;
    }
    
    const currentDealer = gameState.players.find(p => p.id === gameState.currentDealerId);
    if (!currentDealer || currentDealer.userId !== clientSideUserId) {
        toast.error('Alleen de huidige deler kan het bieden starten.');
        return;
    }

    if (gameState.status !== 'bidding') { 
        toast.info(`Bieden kan nu niet gestart worden. Spelstatus: ${gameState.status}. Wachten op biedfase.`);
        return;
    }

    setBiddingInitiationAttempted(true);
    setIsLoading(true); // Show loading for the async action
    toast.info("Bezig met starten van bieden voor de ronde...");

    const formData = new FormData();
    formData.append('gameId', gameState.id.toString());
    if (gameState.currentRound !== null) {
      formData.append('roundNumber', gameState.currentRound.toString());
    } else {
      toast.error("Kan bieden niet starten: Huidige ronde is niet gedefinieerd.");
      setIsLoading(false);
      return;
    }
    formData.append('gamePlayerId', meAsPlayer.id.toString());


    try {
        const result = await initiateBiddingAction({} as any, formData) as InitiateBiddingActionResult; 

        if (result.error) {
            toast.error(result.error || "Starten met bieden mislukt.");
        } else if (result.success) {
            toast.success(result.success || "Bieden succesvol gestart!");
            // Game state will update via broadcast.
        }
    } catch (e: any) {
        toast.error(e.message || "Onverwachte fout bij starten biedproces.");
        console.error("Error in handleInitiateBidding:", e);
    } finally {
        setIsLoading(false); // Hide loading
    }
  };

  const handleProceedToNextRound = () => {
    if (!socket || !gameState) {
      toast.error("Kan niet doorgaan: Socket of spelstatus niet beschikbaar.");
      return;
    }
    // Determine if the current user is the host (player with order 0)
    const hostPlayer = gameState.players.find(p => p.playerOrder === 0);
    if (!hostPlayer || hostPlayer.userId !== clientSideUserId) {
      toast.error("Alleen de host kan de volgende ronde starten.");
      return;
    }

    console.log(`[GamePage] Host (User ID: ${clientSideUserId}) is proceeding to next round for game ID: ${gameId}. Emitting 'proceedToNextRound'.`);
    socket.emit('proceedToNextRound', { gameId: gameState.id });
    setShowRoundSummaryModal(false); // Close modal immediately on client
  };

  // Add this log before the main return
  if (gameState && clientSideUserId) { // Only log if we have some key state elements
    const me = gameState.players.find(p => p.userId === clientSideUserId);
    // console.log(
    //   `[Render Check - User: ${clientSideUserId}] GameID: ${gameId}, Status: ${gameState.status}, MyTurn: ${myTurn}, ` +
    //   `meAsPlayer found: ${!!me}, meAsPlayer ID: ${me?.id}, meAsPlayer hand: ${JSON.stringify(me?.hand)}, ` +
    //   `Raw gameState.players[0].hand (if P1): ${JSON.stringify(gameState.players.find(p=>p.userId ===1)?.hand)}`
    // );
    // New logs for won tricks debugging
    // console.log(`[WonTricksDebug] meAsPlayer:`, JSON.stringify(meAsPlayer));
    // console.log(`[WonTricksDebug] gameState.allCompletedTricksInCurrentRound:`, JSON.stringify(gameState.allCompletedTricksInCurrentRound));
    // console.log(`[WonTricksDebug] myWonTricksThisRound (after filter):`, JSON.stringify(myWonTricksThisRound));
    // console.log(`[WonTricksDebug] meAsPlayer?.id: ${meAsPlayer?.id}`);
  }

  // console.log("[Debug] Rendering GamePage. Current gameState:", gameState);
  // console.log("[Debug] meAsPlayer for UI:", meAsPlayer);
  // console.log("[Debug] myTurn for UI:", myTurn);
  // console.log("[Debug] myWonTricksThisRound for UI:", myWonTricksThisRound);

  const latestRoundSummary = gameState?.roundSummaryData && gameState.roundSummaryData.length > 0 
    ? gameState.roundSummaryData[gameState.roundSummaryData.length - 1] 
    : null;

  const isCurrentUserHost = gameState?.players.find(p => p.playerOrder === 0)?.userId === clientSideUserId;
  const totalRounds = ROUND_DISTRIBUTION.length;
  const isLastRoundForSummary = latestRoundSummary ? latestRoundSummary.roundNumber === totalRounds : false;

  // Helper function to generate card image URL based on new convention
  const getCardImageUrl = (card: Card | null | undefined): string => {
    if (!card) {
      return '/images/playing_cards/card_back.svg'; // Or a placeholder for an empty/error state
    }

    const suitName = card.suit.toLowerCase(); // e.g., 'spades', 'hearts'
    let rankName = card.rank.toUpperCase(); // e.g., 'K', 'Q', 'A', '10', '2'

    // Map internal ranks to filename ranks if they differ
    switch (rankName) {
      case 'A': rankName = 'ace'; break;
      case 'K': rankName = 'king'; break;
      case 'Q': rankName = 'queen'; break;
      case 'J': rankName = 'jack'; break;
      // Numbers 2-10 are assumed to be '2', '3', ..., '10' directly
      // If they were 'TWO', 'THREE', etc., add cases here.
    }

    return `/images/playing_cards/${suitName}_${rankName}.png`;
  };

  // Helper function to generate Dutch alt text for cards
  const getCardAltText = (card: Card | null | undefined): string => {
    if (!card) {
      return 'Kaart achterkant'; // Card back
    }

    let suitText = card.suit.toUpperCase();
    switch (card.suit.toUpperCase()) {
      case 'SPADES': suitText = 'Schoppen'; break;
      case 'HEARTS': suitText = 'Harten'; break;
      case 'CLUBS': suitText = 'Klaveren'; break;
      case 'DIAMONDS': suitText = 'Ruiten'; break;
    }

    let rankText = card.rank.toUpperCase();
    switch (card.rank.toUpperCase()) {
      case 'ACE': rankText = 'Aas'; break;
      case 'KING': rankText = 'Heer'; break;
      case 'QUEEN': rankText = 'Vrouw'; break;
      case 'JACK': rankText = 'Boer'; break;
      case '10': rankText = 'Tien'; break;
      case '9': rankText = 'Negen'; break;
      case '8': rankText = 'Acht'; break;
      case '7': rankText = 'Zeven'; break;
      // Add other ranks if necessary (e.g., 6, 5, 4, 3, 2)
    }
    return `${suitText} ${rankText}`;
  };

  return (
    <div className="container mx-auto px-2 py-4 sm:px-4 sm:py-6 text-slate-100 min-h-screen flex flex-col items-center">
      {isLoading && !gameState && <p className="text-center text-lg text-slate-300">Spelstatus laden...</p>}
      {error && <p className="text-center text-lg text-red-400 bg-red-900/50 p-3 rounded">Fout: {error}</p>}

      {gameState && (
        <>
          {/* Header section for game info */}
          <div className="mb-4 p-3 bg-slate-800/70 rounded-lg shadow">
            <div className="flex justify-between items-center mb-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-50">{gameState.gameName || `Spel ID: ${gameState.id}`}</h1>
              {/* Button onClick={() => fetchGameState()} disabled={isLoading} variant="outline" size="sm" className="border-slate-500 text-slate-200 hover:bg-slate-700 hover:text-slate-50">
                {isLoading ? 'Vernieuwen...' : 'Status Vernieuwen'}
              </Button> */}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
              <p><span className="font-semibold text-slate-300">Status:</span> <span className={`font-bold ${gameState.status === 'active_play' ? 'text-green-400' : gameState.status === 'bidding' ? 'text-yellow-400' : 'text-sky-400'}`}>{gameState.status}</span></p>
              <p><span className="font-semibold text-slate-300">Ronde:</span> {gameState.currentRound ?? 'N/A'} / {ROUND_DISTRIBUTION.length}</p>
              <p>
                <span className="font-semibold text-slate-300">Troef:</span>{' '}
                {gameState.trumpSuit ? (
                  <span className={`font-bold text-2xl ml-1 ${getCardColorClass(gameState.trumpSuit)}`}>
                    {getSuitSymbol(gameState.trumpSuit)}
                  </span>
                ) : (
                  <span className="font-normal text-slate-400">N/A</span>
                )}
              </p>
              <p><span className="font-semibold text-slate-300">Deler:</span> {getFirstName(gameState.players.find(p => p.id === gameState.currentDealerId)?.userName) ?? 'N/A'}</p>
              <p className="col-span-2 sm:col-span-1"><span className="font-semibold text-slate-300">Beurt:</span> <span className={`font-bold ${myTurn ? 'text-lime-400' : 'text-slate-100'}`}>{getFirstName(gameState.players.find(p => p.id === gameState.currentTurnGamePlayerId)?.userName) ?? 'N/A'} {myTurn ? '(Jouw beurt!)' : ''}</span></p>
            </div>
          </div>

          {/* Players Info - Horizontal Layout */}
          <div className="mb-4 grid grid-cols-4 gap-2">
            {gameState.players.map(player => (
              <div key={player.id} className={`p-2 rounded-lg shadow ${player.id === meAsPlayer?.id ? 'bg-sky-700/50 border-2 border-sky-400' : 'bg-slate-700/60'} ${player.id === gameState.currentTurnGamePlayerId ? 'ring-2 ring-lime-400 ring-offset-2 ring-offset-slate-900' : ''}`}>
                <h3 className={`text-base font-semibold truncate ${player.id === meAsPlayer?.id ? 'text-sky-100' : 'text-slate-100'}`}>{getFirstName(player.userName)}</h3>
                <p className="text-xs text-slate-300">Score: {player.currentScore}</p>
                <p className="text-xs text-slate-300">Bod: {player.currentBid === null ? '...' : player.currentBid} / {gameState.currentRound ? ROUND_DISTRIBUTION[gameState.currentRound -1] : 'N/A'}</p>
              </div>
            ))}
          </div>

          {/* Bidding Area */}
          {gameState.status === 'bidding' && myTurn && meAsPlayer && (
            <div className="my-4 p-4 bg-slate-700/80 rounded-lg shadow-lg flex flex-col items-center w-full max-w-md">
              <Label htmlFor="bidAmountSlider" className="text-xl font-semibold mb-3 text-slate-100">
                Jouw Bod voor Ronde {gameState.currentRound} ({meAsPlayer.hand?.length} kaarten):
              </Label>
              <div className="flex flex-col items-center space-y-4 w-full px-4">
                <Slider
                  id="bidAmountSlider"
                  defaultValue={[Math.floor((meAsPlayer.hand?.length ?? 0) / 2)]} // Sensible default
                  value={[parseInt(currentBidAmount as string, 10) || 0]} // Ensure currentBidAmount is a number, default to 0 if parsing fails
                  onValueChange={(newValue: number[]) => setCurrentBidAmount(newValue[0].toString())}
                  max={meAsPlayer.hand?.length ?? 0}
                  min={0}
                  step={1}
                  showTooltip={true}
                  tooltipContent={(value: number) => `Bod: ${value}`}
                  className="w-full"
                  disabled={isSubmittingBid}
                />
                {(() => {
                  const bidValue = parseInt(currentBidAmount as string, 10);
                  const maxBid = meAsPlayer.hand?.length ?? 0;
                  const isBidAmountInvalid = isNaN(bidValue) || bidValue < 0 || bidValue > maxBid;
                  return (
                    <Button 
                      onClick={handleBidSubmit} 
                      disabled={isSubmittingBid || isBidAmountInvalid}
                      className="bg-yellow-500 hover:bg-yellow-600 text-slate-900 font-semibold w-full max-w-xs"
                    >
                      {isSubmittingBid ? 'Bezig met indienen...' : `Dien Bod In: ${currentBidAmount || 0}`}
                    </Button>
                  );
                })()}
              </div>
              {meAsPlayer.hand && <p className="mt-3 text-sm text-slate-300">Je hebt {meAsPlayer.hand.length} kaart(en).</p>}
            </div>
          )}

          {/* Current Trick Display */}
          {gameState.status === 'active_play' && gameState.currentTrickPlays && gameState.currentTrickPlays.length > 0 && (
            <div className="my-4 p-3 bg-slate-700/50 rounded-lg">
              <h4 className="text-md font-semibold mb-2 text-slate-200">Huidige Slag:</h4>
              <div className="flex space-x-2 justify-center items-end flex-wrap">
                {gameState.currentTrickPlays.map((play, index) => (
                  <div key={index} className="p-1 border border-slate-600 rounded bg-slate-800/70 text-center shadow-sm overflow-hidden relative" style={{ width: '60px', height: '85px'}}>
                    <img 
                      src={getCardImageUrl({suit: play.cardSuit, rank: play.cardRank})}
                      alt={getCardAltText({suit: play.cardSuit, rank: play.cardRank})}
                      className="object-contain w-full h-full p-0.5"
                    />
                    <p className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-white bg-black/50 truncate p-0.5">{getFirstName(play.userName)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Player's Hand */}
          {meAsPlayer && meAsPlayer.hand && meAsPlayer.hand.length > 0 && (
            <div className="my-4 p-3 bg-slate-700/50 rounded-lg">
              <h3 className="text-lg font-semibold mb-3 text-center text-slate-100">Jouw Hand ({meAsPlayer.hand.length} kaarten):</h3>
              <div className="flex flex-wrap justify-center gap-2">
                {meAsPlayer.hand.map((card, index) => (
                  <button
                    key={index} 
                    onClick={() => handlePlayCard(card)} 
                    disabled={!myTurn || gameState.status !== 'active_play'}
                    className={`p-0 border-2 border-transparent rounded-md overflow-hidden shadow-md hover:shadow-lg transition-shadow duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-400 ${!myTurn || gameState.status !== 'active_play' ? 'opacity-70 cursor-not-allowed hover:border-transparent' : 'hover:border-sky-400'}`}
                    style={{ width: '70px', height: '100px' }}
                  >
                    <img 
                      src={getCardImageUrl(card)}
                      alt={getCardAltText(card)}
                      className="object-cover w-full h-full"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* All Completed Tricks in Current Round */}
          {gameState.allCompletedTricksInCurrentRound && gameState.allCompletedTricksInCurrentRound.length > 0 && (
            <div className="my-4 p-3 bg-slate-700/50 rounded-lg">
              <h4 className="text-md font-semibold mb-2 text-slate-200">Voltooide Slagen Deze Ronde (Jij nam: {myWonTricksThisRound.length}):</h4>
              <div className="space-y-3">
                {gameState.allCompletedTricksInCurrentRound.map((trick) => (
                  <div key={trick.trickNumberInRound} className="p-2 border border-slate-600 rounded bg-slate-800/60">
                    <p className="text-sm font-medium text-slate-300 mb-1">
                      Slag {trick.trickNumberInRound} - Gewonnen door: <span className={`font-bold ${trick.winningGamePlayerId === meAsPlayer?.id ? 'text-lime-400' : 'text-sky-300'}`}>{getFirstName(trick.winnerName)}</span>
                    </p>
                    <div className="flex space-x-1 sm:space-x-2 justify-start items-center flex-wrap text-xs">
                      {trick.cards.map((card, cardIndex) => (
                        <div key={cardIndex} className="p-0.5 border border-slate-700 rounded bg-slate-900/70 text-center shadow-sm overflow-hidden relative" style={{ width: '50px', height: '70px'}}>
                          <img 
                            src={getCardImageUrl({suit: card.cardSuit, rank: card.cardRank})}
                            alt={getCardAltText({suit: card.cardSuit, rank: card.cardRank})}
                            className="object-contain w-full h-full"
                          />
                          <p className="absolute bottom-0 left-0 right-0 text-center text-[9px] text-white bg-black/50 truncate p-0.5">{getFirstName(card.playerName)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Game Over Section */}
          {gameState.status === 'finished' && (
            <div className="my-6 p-6 bg-slate-800 rounded-lg shadow-xl text-center">
              <h2 className="text-4xl font-bold text-yellow-400 mb-4">SPEL VOORBIJ!</h2>
              {gameState.players.sort((a,b) => b.currentScore - a.currentScore).map((player, index) => (
                <div key={player.id} className={`py-2 px-3 my-1 rounded ${index === 0 ? 'bg-yellow-500/80 text-slate-900' : 'bg-slate-700/70 text-slate-100'}`}>
                  <span className="text-xl font-semibold">{index + 1}. {getFirstName(player.userName)}</span>: <span className="font-bold text-lg">{player.currentScore} punten</span>
                  {index === 0 && <span className="ml-2 text-2xl">🏆</span>}
                </div>
              ))}
              <Button onClick={() => router.push('/')} className="mt-8 bg-sky-600 hover:bg-sky-700 text-slate-50 text-lg px-6 py-3">
                Terug naar Startpagina
              </Button>
            </div>
          )}

          {showRoundSummaryModal && latestRoundSummary && (
            <RoundSummaryModal
              roundSummary={latestRoundSummary}
              onClose={() => setShowRoundSummaryModal(false)}
              onProceedToNextRound={handleProceedToNextRound}
              isHost={isCurrentUserHost}
              isLastRound={isLastRoundForSummary}
            />
          )}
        </>
      )}
    </div>
  );
}

// Helper function to get suit symbol
const getSuitSymbol = (suit: string) => {
  switch (suit) {
    case 'HEARTS': return '♥';
    case 'DIAMONDS': return '♦';
    case 'CLUBS': return '♣';
    case 'SPADES': return '♠';
    default: return suit;
  }
};

// Helper function to get card color class
const getCardColorClass = (suit: string, small: boolean = false) => {
  if (suit === 'HEARTS' || suit === 'DIAMONDS') {
    return small ? 'text-red-400' : 'text-red-500';
  }
  return small ? 'text-slate-300' : 'text-slate-100'; // Default to light color for dark suits on dark bg
};

// Define a more specific type for a single round summary item
interface PlayerRoundDetail {
  gamePlayerId: number;
  playerName: string;
  scoreChange: number;
  cumulativeScoreAfterRound: number;
}
interface RoundSummaryItem {
  roundNumber: number;
  playerRoundDetails: PlayerRoundDetail[];
}

interface RoundSummaryModalProps {
  roundSummary: RoundSummaryItem | null;
  onClose: () => void;
  onProceedToNextRound: () => void;
  isHost: boolean;
  isLastRound: boolean;
}

const RoundSummaryModal: React.FC<RoundSummaryModalProps> = ({ roundSummary, onClose, onProceedToNextRound, isHost, isLastRound }) => {
  if (!roundSummary) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto text-slate-100">
        <h2 className="text-2xl font-bold mb-4 text-center text-slate-50">Ronde {roundSummary.roundNumber} Overzicht</h2>
        <table className="w-full mb-6 border-collapse">
          <thead>
            <tr className="border-b border-slate-600">
              <th className="text-left p-2 text-slate-300">Speler</th>
              <th className="text-right p-2 text-slate-300">Scorewijziging</th>
              <th className="text-right p-2 text-slate-300">Totaalscore</th>
            </tr>
          </thead>
          <tbody>
            {roundSummary.playerRoundDetails.map((detail) => (
              <tr key={detail.gamePlayerId} className="border-b border-slate-700 last:border-b-0">
                <td className="p-2 text-slate-200">{getFirstName(detail.playerName)}</td>
                <td className={`p-2 text-right font-semibold ${detail.scoreChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {detail.scoreChange >= 0 ? `+${detail.scoreChange}` : detail.scoreChange}
                </td>
                <td className="p-2 text-right text-slate-100">{detail.cumulativeScoreAfterRound}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <Button onClick={onClose} variant="outline" className="bg-slate-700 hover:bg-slate-600 border-slate-500 text-slate-100">Sluiten</Button>
          {isHost && (
            <Button onClick={onProceedToNextRound} className="bg-green-600 hover:bg-green-700 text-white">
              {isLastRound ? 'Bekijk Eindscores & Beëindig Spel' : 'Start Volgende Ronde'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}; 