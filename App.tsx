// App.tsx - PIXEL SQUISHER
import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  Dimensions,
  ActivityIndicator,
  Vibration,
  Linking,
  Modal,
  TextInput,
  PermissionsAndroid,
  Animated,
  Easing,
  Image,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { Video } from 'react-native-compressor';
import { createThumbnail } from 'react-native-create-thumbnail';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Share from 'react-native-share';
import storage from '@react-native-firebase/storage';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Rect, Line } from 'react-native-svg';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import Animated_R, { useSharedValue, withRepeat, withSequence, withTiming, withDelay, useAnimatedStyle, makeMutable, Easing as REasing } from 'react-native-reanimated';

interface CompressedVideo {
  id: string;
  originalPath: string;
  compressedPath: string;
  originalSize: number;
  compressedSize: number;
  bitrate: number;
  timestamp: number;
  submitted: boolean;
  expiresAt: number;
  title: string;
  mode: string;
  thumbnail?: string;
  expired?: boolean;
}

interface SubmissionForm {
  name: string;
  email: string;
  details: string;
}

interface CompressionMode {
  name: string;
  description: string;
  bitrate: number;
  maxSize?: number;
  disableAudio?: boolean;
}

// Budget note: total MB/min = (video bitrate + audio bitrate) / 8 * 60 / 1e6.
// Audio is passed through untouched by the encoder, so lower modes drop it to hit target.
// Resolution is capped on every mode so the hardware encoder actually honors the low bitrate.
// Resolution and bitrate option ladders for the custom panel
const RES_OPTIONS = [
  { label: '480p', value: 480 },
  { label: '360p', value: 360 },
  { label: '240p', value: 240 },
  { label: '144p', value: 144 },
];
// Encoder-floor fallback ladder. When a device's hardware encoder rejects a
// resolution+bitrate combo (common at low res + low bitrate on some chipsets),
// we retry: first bump the bitrate (keeps the low resolution the user chose),
// then as a last resort bump the resolution.
const BITRATE_LADDER = [32000, 48000, 64000, 100000, 120000];
const RES_LADDER = [144, 240, 360, 480];

const buildFallbackAttempts = (res: number, bitrate: number) => {
  const attempts: { maxSize: number; bitrate: number; reason: string }[] = [];
  // 1. Same resolution, step bitrate up through the ladder
  for (const b of BITRATE_LADDER) {
    if (b > bitrate) attempts.push({ maxSize: res, bitrate: b, reason: 'bitrate' });
  }
  // 2. Then step resolution up (at a safe mid bitrate), last resort
  for (const r of RES_LADDER) {
    if (r > res) attempts.push({ maxSize: r, bitrate: Math.max(bitrate, 64000), reason: 'resolution' });
  }
  return attempts;
};

const BITRATE_OPTIONS = [
  { label: 'Standard', value: 120000 },
  { label: 'Low', value: 64000 },
  { label: 'Crushed', value: 32000 },
];

// Every one of the 24 combos (4 resolutions x 3 bitrates x 2 audio states) has a name.
// Keyed as `${res}-${bitrate}-${audio ? 'a' : 's'}`. All-standard-with-sound = STANDARD.
const COMBO_NAMES: { [key: string]: string } = {
  // 480p
  '480-120000-a': 'STANDARD',
  '480-120000-s': 'MIME',
  '480-64000-a': 'FM',
  '480-64000-s': 'QUIET STANDARD',
  '480-32000-a': 'STATIC',
  '480-32000-s': 'CLEAN CRUSH',
  // 360p
  '360-120000-a': 'MIASMA',
  '360-120000-s': 'SILENT FEATURE',
  '360-64000-a': 'THRIFT',
  '360-64000-s': 'THRIFT SILENT',
  '360-32000-a': 'BUDGET TALKIE',
  '360-32000-s': 'PENNY DREADFUL',
  // 240p
  '240-120000-a': 'SEDIMENT',
  '240-120000-s': 'OOZE',
  '240-64000-a': 'WHISPER',
  '240-64000-s': 'SILENT WHISPER',
  '240-32000-a': 'PIXEL BROTH',
  '240-32000-s': 'PIXEL SOUP',
  // 144p
  '144-120000-a': 'LOZENGE',
  '144-120000-s': 'POSTAGE STAMP',
  '144-64000-a': 'SIGNAL',
  '144-64000-s': 'VIDEO',
  '144-32000-a': 'HAUNTED THUMBNAIL',
  '144-32000-s': 'HOMEOPATHIC',
};

const nameCustomCombo = (res: number, bitrate: number, audio: boolean): string => {
  return COMBO_NAMES[`${res}-${bitrate}-${audio ? 'a' : 's'}`] || 'CUSTOM SQUISH';
};

const CUSTOM_TAGLINES = [
  'you built this', 'a bespoke squish', 'your recipe', 'hand-tuned crush',
  'artisanal compression', 'small by design',
];

const COMPRESSION_MODES: CompressionMode[] = [
  { name: 'Standard', description: '~1.44 MB/min · 480p with sound', bitrate: 120000, maxSize: 480 },
  { name: 'Tiny', description: '~1.0 MB/min · 360p with sound', bitrate: 80000, maxSize: 360 },
  { name: 'Micro', description: '~0.5 MB/min · 360p, silent', bitrate: 64000, maxSize: 360, disableAudio: true },
  { name: 'Blocky', description: '~0.4 MB/min · 360p, silent, pixelated', bitrate: 48000, maxSize: 360, disableAudio: true },
  { name: 'Pixel Soup', description: '~0.3 MB/min · 320p, silent, max crush', bitrate: 40000, maxSize: 320, disableAudio: true },
];

const AUTO_DELETE_AFTER = 7 * 24 * 60 * 60 * 1000;
// Set this to the real installed size after the release build, then the About line appears.
const APP_SIZE_MB = 0;




const S_W = Dimensions.get('window').width;
const S_H = Dimensions.get('window').height;
const COLS = 6;
const PIXEL_SIZE = Math.ceil(S_W / COLS) + 1;
const ROWS = Math.ceil(S_H / PIXEL_SIZE) + 1;
const TOTAL = COLS * ROWS;
const PIXEL_COLORS = [
  '#0ad86d', '#0ad86d', '#0ad86d', '#0ad86d',
  '#0ad86d', '#08c060', '#09d068', '#0ad86d',
  '#07b055', '#0ad86d', '#0ad86d', '#06a050',
];
// Intro pixel: holds ~300ms, then dissolves on the UI thread. Self-contained.
const DissolvePixel = ({ color }: { color: string }) => {
  const op = useSharedValue(1);
  React.useEffect(() => {
    op.value = withDelay(
      380 + Math.random() * 400,
      withTiming(0, { duration: 80 + Math.random() * 180, easing: REasing.out(REasing.ease) })
    );
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: op.value }));
  return (
    <Animated_R.View
      style={[{ width: PIXEL_SIZE, height: PIXEL_SIZE, backgroundColor: color }, st]}
    />
  );
};

// Gentle opacity pulse for the compressing skeleton entry
const SkeletonPulse = ({ children }: { children: React.ReactNode }) => {
  const op = useSharedValue(0.35);
  React.useEffect(() => {
    op.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 700, easing: REasing.inOut(REasing.ease) }),
        withTiming(0.35, { duration: 700, easing: REasing.inOut(REasing.ease) })
      ),
      -1,
      false
    );
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: op.value }));
  return <Animated_R.View style={st}>{children}</Animated_R.View>;
};

const GlowPixel = ({ sv, maxOpacity }: { sv: import('react-native-reanimated').SharedValue<number>, maxOpacity: number }) => {
  const animStyle = useAnimatedStyle(() => ({
    opacity: sv.value * maxOpacity,
  }));
  return <Animated_R.View style={[glowPixelStyle, animStyle]} />;
};
const glowPixelStyle = { width: 60, height: 60, backgroundColor: '#fff' as const };

const TvIcon = ({ color = '#888', size = 22 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="2" y="7" width="20" height="14" rx="2" ry="2"
      fill="none" stroke={color} strokeWidth="2" />
    <Line x1="9" y1="7" x2="6" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <Line x1="15" y1="7" x2="18" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </Svg>
);

const App = () => {
  const [videos, setVideos] = useState<CompressedVideo[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [totalSaved, setTotalSaved] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentUploadIndex, setCurrentUploadIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  // Custom compression settings. resolution/bitrate are live; frameRate/color are
  // placeholders for a future FFmpeg-backed build (disabled in UI for now).
  const [customRes, setCustomRes] = useState(480);
  const [customBitrate, setCustomBitrate] = useState(120000);
  const [customAudio, setCustomAudio] = useState(true);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedForSubmit, setSelectedForSubmit] = useState<string[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [submissionForm, setSubmissionForm] = useState<SubmissionForm>({
    name: '',
    email: '',
    details: '',
  });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [pixelsDone, setPixelsDone] = useState(false);

  const [screen, setScreen] = useState<'main' | 'library' | 'about'>('main');
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const fadeAnims = useRef<{[key: string]: Animated.Value}>({}).current;
  const GLOW_COLS = 5;
  const GLOW_ROWS = 5;
  const GLOW_TOTAL = GLOW_COLS * GLOW_ROWS;
  const glowSharedValues = useRef(
    Array.from({ length: GLOW_TOTAL }, () => makeMutable(Math.random()))
  ).current;
  const cancelRequestedRef = useRef(false);
  const compressionIdRef = useRef<string | null>(null);
  const MAX_DURATION_SECONDS = 20 * 60; // 20 minutes
  const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
  const squishScale = useRef(new Animated.Value(1)).current;
  // Precompute circular distance falloff: 1.0 at center, 0 at edge
  const glowFalloff = useMemo(() => {
    const cx = (GLOW_COLS - 1) / 2;
    const cy = (GLOW_ROWS - 1) / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    return Array.from({ length: GLOW_TOTAL }, (_, i) => {
      const col = i % GLOW_COLS;
      const row = Math.floor(i / GLOW_COLS);
      const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
      return Math.max(0, 1 - dist / maxDist);
    });
  }, []);
  const SCREEN_WIDTH = Dimensions.get('window').width;
  const mainSlide = useRef(new Animated.Value(0)).current;
  const librarySlide = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const libraryOpacity = useRef(new Animated.Value(0)).current;
  const aboutSlide = useRef(new Animated.Value(-SCREEN_WIDTH)).current;
  const aboutOpacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const initializeApp = async () => {
      await loadVideos();
      await requestStoragePermission();
      checkAndDeleteExpired();
      const saved = await AsyncStorage.getItem('total_bytes_saved');
      if (saved) setTotalSaved(parseInt(saved, 10) || 0);
    };

    initializeApp();

    // Unmount the intro grid once every pixel has finished (280+280+200ms, plus margin)
    const introTimer = setTimeout(() => setPixelsDone(true), 1150);
    
    const interval = setInterval(() => {
      checkAndDeleteExpired();
    }, 60000);

    return () => { clearInterval(interval); clearTimeout(introTimer); };
  }, []);

  // Pixel flicker using Reanimated - runs on UI thread
  const glowFlickerLoop = () =>
    withRepeat(
      withSequence(
        withTiming(Math.random(), { duration: 700 + Math.random() * 1600, easing: REasing.inOut(REasing.ease) }),
        withTiming(Math.random(), { duration: 700 + Math.random() * 1600, easing: REasing.inOut(REasing.ease) }),
      ),
      -1,
      false
    );

  React.useEffect(() => {
    glowSharedValues.forEach((sv, i) => {
      sv.value = withDelay(i * 40 + Math.random() * 300, glowFlickerLoop());
    });
  }, []);

  const onSquishPressIn = () => {
    Vibration.vibrate(15);
    Animated.timing(squishScale, {
      toValue: 0.88,
      duration: 120,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
    // Flare bright, then hand back to the endless flicker loop
    glowSharedValues.forEach(sv => {
      sv.value = withSequence(
        withTiming(0.7 + Math.random() * 0.3, { duration: 100 + Math.random() * 80 }),
        glowFlickerLoop()
      );
    });
  };

  const onSquishPressOut = () => {
    Animated.spring(squishScale, {
      toValue: 1,
      tension: 120,
      friction: 6,
      useNativeDriver: false,
    }).start();
  };

  const navigateToLibrary = () => {
    const W = Dimensions.get('window').width;
    mainSlide.setValue(0);
    librarySlide.setValue(W);
    libraryOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(mainSlide, {
        toValue: -W,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(libraryOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: false,
      }),
      Animated.timing(librarySlide, {
        toValue: 0,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start(() => setScreen('library'));
  };

  const navigateToMain = () => {
    const W = Dimensions.get('window').width;
    Animated.parallel([
      Animated.timing(mainSlide, {
        toValue: 0,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(libraryOpacity, {
        toValue: 0,
        duration: 320,
        useNativeDriver: false,
      }),
      Animated.timing(librarySlide, {
        toValue: W,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setScreen('main');
      mainSlide.setValue(0);
    });
  };

  const navigateToAbout = () => {
    const W = Dimensions.get('window').width;
    mainSlide.setValue(0);
    aboutSlide.setValue(-W);
    aboutOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(mainSlide, {
        toValue: W,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(aboutOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: false,
      }),
      Animated.timing(aboutSlide, {
        toValue: 0,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start(() => setScreen('about'));
  };

  const navigateFromAbout = () => {
    const W = Dimensions.get('window').width;
    Animated.parallel([
      Animated.timing(mainSlide, {
        toValue: 0,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(aboutOpacity, {
        toValue: 0,
        duration: 320,
        useNativeDriver: false,
      }),
      Animated.timing(aboutSlide, {
        toValue: -W,
        duration: 320,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setScreen('main');
      mainSlide.setValue(0);
    });
  };

  const checkAndDeleteExpired = async () => {
    const now = Date.now();
    const saved = await AsyncStorage.getItem('compressed_videos');
    if (!saved) return;

    const allVideos: CompressedVideo[] = JSON.parse(saved);
    const hasNewExpired = allVideos.some(v => v.expiresAt <= now && !v.expired);
    
    if (hasNewExpired) {
      // Delete the actual files but keep entries in list marked as expired
      for (const video of allVideos.filter(v => v.expiresAt <= now && !v.expired)) {
        try {
          await RNFS.unlink(video.compressedPath);
        } catch (error) {
          console.error('Error deleting expired video file:', error);
        }
      }
      const updatedVideos = allVideos.map(v =>
        v.expiresAt <= now ? { ...v, expired: true } : v
      );
      await AsyncStorage.setItem('compressed_videos', JSON.stringify(updatedVideos));
      setVideos(updatedVideos);
    }
  };

  const dismissExpiredVideo = async (videoId: string) => {
    const updatedVideos = videos.filter(v => v.id !== videoId);
    await saveVideos(updatedVideos);
  };

  const requestStoragePermission = async () => {
    if (Platform.OS === 'android') {
      try {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
        );
      } catch (err) {
        console.warn(err);
      }
    }
  };

  const loadVideos = async () => {
    try {
      const saved = await AsyncStorage.getItem('compressed_videos');
      if (saved) {
        const loadedVideos = JSON.parse(saved);
        setVideos(loadedVideos);
        
        loadedVideos.forEach((video: CompressedVideo) => {
          if (!fadeAnims[video.id]) {
            fadeAnims[video.id] = new Animated.Value(0);
            Animated.timing(fadeAnims[video.id], {
              toValue: 1,
              duration: 400,
              useNativeDriver: false,
            }).start();
          }
        });
      }
    } catch (error) {
      console.error('Error loading videos:', error);
    }
  };

  const saveVideos = async (updatedVideos: CompressedVideo[]) => {
    try {
      await AsyncStorage.setItem('compressed_videos', JSON.stringify(updatedVideos));
      setVideos(updatedVideos);
    } catch (error) {
      console.error('Error saving videos:', error);
    }
  };

  const selectAndCompressVideo = () => {
    setShowModeSelector(true);
  };

  const runCustomCompression = () => {
    const mode: CompressionMode = {
      name: nameCustomCombo(customRes, customBitrate, customAudio),
      description: CUSTOM_TAGLINES[Math.floor(Math.random() * CUSTOM_TAGLINES.length)],
      bitrate: customBitrate,
      maxSize: customRes,
      disableAudio: !customAudio,
    };
    setShowCustomPanel(false);
    startCompression(mode);
  };

  const startCompression = async (mode: CompressionMode) => {
    setShowModeSelector(false);
    if (selecting || compressing) return;

    try {
      setSelecting(true);
      const result = await launchImageLibrary({
        mediaType: 'video',
        selectionLimit: 1,
      });
      setSelecting(false);

      if (result.didCancel || !result.assets?.[0]) {
        return;
      }

      const video = result.assets[0];

      // Instant metadata checks - no file loading needed
      if (video.fileSize && video.fileSize > MAX_FILE_SIZE_BYTES) {
        Alert.alert('File Too Large', 'Please choose a video under 2GB.');
        return;
      }
      if (video.duration && video.duration > MAX_DURATION_SECONDS * 1000) {
        Alert.alert('Video Too Long', 'Please choose a video under 20 minutes.');
        return;
      }

      const inputPath = Platform.OS === 'ios'
        ? video.uri?.replace('file://', '') || ''
        : video.uri || '';

      if (!inputPath) {
        Alert.alert('Error', 'Invalid video path');
        return;
      }

      cancelRequestedRef.current = false;
      setCompressing(true);
      setProgress(0);
      navigateToLibrary();

      // Encoder-floor fallback: some devices reject a resolution+bitrate combo
      // (e.g. 144p at the lowest bitrate). Retry up a ladder — bitrate first so
      // the chosen resolution is preserved, resolution only as a last resort.
      const isEncoderError = (e: any) => {
        const msg = String(e?.message || e);
        return msg.includes('ENCODER_RESOLUTION_UNSUPPORTED') ||
               msg.includes('IllegalArgumentException') ||
               msg.includes('configure');
      };

      try {
        await compressVideo(inputPath, mode);
      } catch (err) {
        if (cancelRequestedRef.current) throw err;
        if (!isEncoderError(err) || !mode.maxSize) throw err;

        const attempts = buildFallbackAttempts(mode.maxSize, mode.bitrate);
        let succeeded = false;
        let landedRes = mode.maxSize;

        for (const attempt of attempts) {
          if (cancelRequestedRef.current) break;
          try {
            setProgress(0);
            await compressVideo(inputPath, { ...mode, maxSize: attempt.maxSize, bitrate: attempt.bitrate });
            succeeded = true;
            landedRes = attempt.maxSize;
            break;
          } catch (retryErr) {
            if (cancelRequestedRef.current) throw retryErr;
            if (!isEncoderError(retryErr)) throw retryErr;
            // else keep trying the next rung
          }
        }

        if (!succeeded) {
          throw new Error('ENCODER_RESOLUTION_UNSUPPORTED');
        }

        // Only tell the user if the resolution actually changed. A silent
        // bitrate bump at the same resolution needs no explanation.
        if (landedRes !== mode.maxSize) {
          Alert.alert(
            'Resolution adjusted',
            `${mode.maxSize}p isn't supported on this device. Compressed at ${landedRes}p instead.`
          );
        }
      }

      if (!cancelRequestedRef.current) {
        setCompressing(false);
        setProgress(0);
      }
    } catch (error) {
      setSelecting(false);
      if (!cancelRequestedRef.current) {
        setCompressing(false);
        setProgress(0);
        const msg = String((error as any)?.message || error);
        if (msg.includes('ENCODER_RESOLUTION_UNSUPPORTED') ||
            msg.includes('IllegalArgumentException') ||
            msg.includes('configure')) {
          Alert.alert(
            'Compression Failed',
            "This device's encoder couldn't process that setting. Try a higher resolution."
          );
        } else {
          Alert.alert('Error', 'Something went wrong. Please try again.');
        }
      }
    }
  };

  const compressVideo = async (inputPath: string, mode: CompressionMode) => {
    try {
      const stat = await RNFS.stat(inputPath);
      const originalSize = stat.size;

      const timestamp = Date.now();
      const outputDir = `${RNFS.DocumentDirectoryPath}/compressed`;
      await RNFS.mkdir(outputDir);
      
      const modeName = mode.name.toLowerCase().replace(/\s+/g, '_');
      const dateStr = new Date(timestamp).toISOString().slice(0, 10).replace(/-/g, '');
      const newTitle = `PixelSquisher_${dateStr}_${modeName}`;
      const outputPath = `${outputDir}/${newTitle}_${timestamp}.mp4`;

      const result = await Video.compress(
        inputPath,
        {
          compressionMethod: 'manual',
          bitrate: mode.bitrate,
          maxSize: mode.maxSize || 480,
          disableAudio: mode.disableAudio ?? false,
          minimumFileSizeForCompress: 0,
          getCancellationId: (id) => { compressionIdRef.current = id; },
        },
        (progressValue) => {
          if (cancelRequestedRef.current) return;
          setProgress(progressValue);
        }
      );

      if (result !== inputPath) {
        await RNFS.moveFile(result, outputPath);
      }

      if (cancelRequestedRef.current) {
        try { await RNFS.unlink(outputPath); } catch (e) {}
        return;
      }

      const compressedStat = await RNFS.stat(outputPath);
      const compressedSize = compressedStat.size;
      const estimatedBitrate = mode.bitrate / 1000;

      // Guard: encoder produced a broken/empty file (happens when the device's
      // encoder won't accept the requested resolution, e.g. 144p on some chipsets).
      if (compressedSize < 10 * 1024) {
        try { await RNFS.unlink(outputPath); } catch (e) {}
        throw new Error('ENCODER_RESOLUTION_UNSUPPORTED');
      }

      // Block if compression didn't actually reduce file size
      if (compressedSize >= originalSize) {
        try {
          await RNFS.unlink(outputPath);
        } catch (e) {
          console.error('Cleanup error:', e);
        }
        Alert.alert(
          'Already Compressed',
          "This video is already highly compressed. Squishing it further didn't reduce the file size. Try a different mode or a less-compressed source file."
        );
        return;
      }

      // Generate thumbnail
      let thumbnailPath;
      try {
        const thumbnail = await createThumbnail({
          url: `file://${outputPath}`,
          timeStamp: 1000,
        });
        thumbnailPath = thumbnail.path;
      } catch (error) {
        console.error('Thumbnail generation failed:', error);
        thumbnailPath = undefined;
      }

      const newVideo: CompressedVideo = {
        id: `video_${timestamp}`,
        originalPath: inputPath,
        compressedPath: outputPath,
        originalSize,
        compressedSize,
        bitrate: estimatedBitrate,
        timestamp,
        submitted: false,
        expiresAt: timestamp + AUTO_DELETE_AFTER,
        title: newTitle,
        mode: mode.name,
        thumbnail: thumbnailPath,
      };

      const updatedVideos = [newVideo, ...videos];
      await saveVideos(updatedVideos);

      // Update lifetime data-saved counter
      const prevSaved = parseInt((await AsyncStorage.getItem('total_bytes_saved')) || '0', 10);
      const newSaved = prevSaved + (originalSize - compressedSize);
      await AsyncStorage.setItem('total_bytes_saved', String(newSaved));
      setTotalSaved(newSaved);

      fadeAnims[newVideo.id] = new Animated.Value(0);
      Animated.timing(fadeAnims[newVideo.id], {
        toValue: 1,
        duration: 600,
        useNativeDriver: false,
      }).start();

      showSuccessAnimation();
    } catch (error) {
      if (cancelRequestedRef.current) return;
      console.error('Compression error:', error);
      // Re-throw so the caller can apply the encoder-floor fallback.
      // The caller alerts if there is no fallback to apply.
      throw error;
    }
  };

  const showSuccessAnimation = () => {
    setShowSuccess(true);
    checkmarkScale.setValue(0);
    
    Animated.sequence([
      Animated.spring(checkmarkScale, {
        toValue: 1,
        tension: 50,
        friction: 3,
        useNativeDriver: false,
      }),
      Animated.delay(1500),
      Animated.timing(checkmarkScale, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start(() => setShowSuccess(false));
  };

  const cancelCompression = () => {
    cancelRequestedRef.current = true;
    if (compressionIdRef.current) {
      try { Video.cancelCompression(compressionIdRef.current); } catch (e) {}
      compressionIdRef.current = null;
    }
    setCompressing(false);
    setProgress(0);
  };

  const enableSelectionMode = () => {
    if (videos.length === 0) {
      Alert.alert('No Videos', 'Compress a video first, then submit it to Small File TV!');
      return;
    }
    setSelectionMode(true);
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedForSubmit([]);
  };

  const toggleVideoSelection = (videoId: string) => {
    if (!selectionMode) return;
    
    if (selectedForSubmit.includes(videoId)) {
      setSelectedForSubmit(selectedForSubmit.filter(id => id !== videoId));
    } else {
      if (selectedForSubmit.length >= 5) {
        Alert.alert('Limit Reached', 'You can select up to 5 videos at a time');
        return;
      }
      setSelectedForSubmit([...selectedForSubmit, videoId]);
    }
  };

  const openMultiSubmitModal = () => {
    if (selectedForSubmit.length === 0) {
      Alert.alert('No Selection', 'Please select videos to submit');
      return;
    }
    setSubmissionForm({ name: '', email: '', details: '' });
    setAgreedToTerms(false);
    setShowSubmitModal(true);
  };

  const handleLongPress = (videoId: string) => {
    setSelectedVideo(videoId);
    setShowContextMenu(true);
  };

  const closeContextMenu = () => {
    setShowContextMenu(false);
    setSelectedVideo(null);
  };

  const shareVideoFile = async (path: string) => {
    try {
      const exists = await RNFS.exists(path);
      if (!exists) {
        Alert.alert('Share Failed', 'File not found on device.');
        return;
      }
      await Share.open({
        url: `file://${path}`,
        type: 'video/mp4',
        filename: path.split('/').pop() || 'video.mp4',
        failOnCancel: false,
      });
    } catch (error: any) {
      const msg = String(error?.message || error);
      if (
        !msg.includes('User did not share') &&
        !msg.includes('cancel') &&
        !msg.includes('CANCEL')
      ) {
        Alert.alert('Share Failed', msg);
      }
    }
  };

  const shareVideo = async () => {
    const video = videos.find(v => v.id === selectedVideo);
    closeContextMenu();
    if (!video) return;
    shareVideoFile(video.compressedPath);
  };

  const saveToGallery = async () => {
    const video = videos.find(v => v.id === selectedVideo);
    closeContextMenu();
    if (!video) return;

    try {
      await CameraRoll.saveAsset(`file://${video.compressedPath}`, { type: 'video' });
      Alert.alert('Saved', 'Video saved to your gallery');
    } catch (error) {
      Alert.alert('Error', 'Failed to save video to gallery');
    }
  };

  const openSingleSubmitModal = () => {
    closeContextMenu();
    setSelectedForSubmit([selectedVideo!]);
    setSubmissionForm({ name: '', email: '', details: '' });
    setAgreedToTerms(false);
    setShowSubmitModal(true);
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const submitVideos = async () => {
    if (!submissionForm.name.trim()) {
      Alert.alert('Required', 'Please enter your name');
      return;
    }
    if (!submissionForm.email.trim()) {
      Alert.alert('Required', 'Please enter your email');
      return;
    }
    if (!validateEmail(submissionForm.email)) {
      Alert.alert('Invalid', 'Please enter a valid email');
      return;
    }
    if (!agreedToTerms) {
      Alert.alert('Agreement Required', 'Please agree to the terms before submitting');
      return;
    }

    const videosToSubmit = videos.filter(v => selectedForSubmit.includes(v.id));
    if (videosToSubmit.length === 0) return;

    try {
      setUploading(true);
      setUploadProgress(0);
      setCurrentUploadIndex(0);

      for (let i = 0; i < videosToSubmit.length; i++) {
        const video = videosToSubmit[i];
        setCurrentUploadIndex(i + 1);

        const filename = `${video.title}_${video.timestamp}.mp4`;
        const reference = storage().ref(`submissions/${filename}`);

        const metadata = {
          customMetadata: {
            submitterName: submissionForm.name,
            submitterEmail: submissionForm.email,
            details: submissionForm.details || 'No details provided',
            fileSize: video.compressedSize.toString(),
            bitrate: video.bitrate.toString(),
            videoTitle: video.title,
            compressionMode: video.mode,
            agreedToTerms: 'true',
            submittedAt: new Date().toISOString(),
          },
        };

        const task = reference.putFile(video.compressedPath, metadata);

        task.on('state_changed', (snapshot) => {
          const progress = (i + snapshot.bytesTransferred / snapshot.totalBytes) / videosToSubmit.length;
          setUploadProgress(progress);
        });

        await task;
      }

      const updatedVideos = videos.map(v =>
        selectedForSubmit.includes(v.id) ? { ...v, submitted: true } : v
      );
      await saveVideos(updatedVideos);

      setUploading(false);
      setShowSubmitModal(false);
      setSelectedForSubmit([]);
      setSelectionMode(false);
      
      Alert.alert(
        'Submitted!',
        `${videosToSubmit.length} video${videosToSubmit.length > 1 ? 's' : ''} submitted to Small File TV. We'll review soon!`
      );
    } catch (error: any) {
      setUploading(false);
      console.error('Submit error:', error);
      Alert.alert(
        'Submission Failed', 
        `Error: ${error.message || 'Unknown error'}\n\nMake sure you have internet connection.`
      );
    }
  };

  const deleteVideo = async () => {
    const video = videos.find(v => v.id === selectedVideo);
    closeContextMenu();

    Alert.alert(
      'Delete',
      'Remove this video?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (video) {
              try {
                await RNFS.unlink(video.compressedPath);
              } catch (error) {
                console.error('Error deleting:', error);
              }
            }
            const updatedVideos = videos.filter(v => v.id !== selectedVideo);
            await saveVideos(updatedVideos);
          },
        },
      ]
    );
  };

  const formatSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const getDaysUntilExpiry = (expiresAt: number): number => {
    const now = Date.now();
    const diff = expiresAt - now;
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  };

  const getReductionPercentage = (video: CompressedVideo): number => {
    if (video.originalSize === 0) return 0;
    const reduction = ((video.originalSize - video.compressedSize) / video.originalSize) * 100;
    return Math.max(0, Math.min(100, Math.round(reduction)));
  };



  return (
    <View style={styles.container}>

      {/* ── MAIN SCREEN ── */}
      <Animated.View
        style={[
          styles.screenMain,
          { transform: [{ translateX: mainSlide }] },
        ]}
        pointerEvents={screen === 'main' ? 'auto' : 'none'}
      >
        <View style={styles.header}>
          <Text style={styles.title}>PIXEL SQUISHER</Text>
        </View>

        <View style={styles.mainCenter}>
          {/* Pixel flicker glow - Reanimated, runs on UI thread */}
          <View style={styles.glowPixelGrid} pointerEvents="none">
            {glowSharedValues.map((sv, i) => (
              <GlowPixel key={i} sv={sv} maxOpacity={glowFalloff[i] * 0.35} />
            ))}
          </View>

          {/* OLD glow rings removed -- see comment at bottom of file to revert */}
          <Pressable
              onPress={selectAndCompressVideo}
              onPressIn={onSquishPressIn}
              onPressOut={onSquishPressOut}
            >
              <Animated.View style={{ transform: [{ scale: squishScale }] }}>
                <View style={styles.squishButton}>
                  <Text style={styles.squishButtonText}>{`SQUISH\nVIDEO`}</Text>
                </View>
              </Animated.View>
            </Pressable>
        </View>

        <View style={styles.mainNavRow}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={navigateToAbout}
            activeOpacity={0.8}
          >
            <Text style={styles.navButtonText}>i</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navButton}
            onPress={navigateToLibrary}
            activeOpacity={0.8}
          >
            <Text style={styles.navButtonText}>≡</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ── LIBRARY SCREEN ── */}
      <Animated.View
        style={[
          styles.screenLibrary,
          {
            opacity: libraryOpacity,
            transform: [{ translateX: librarySlide }],
          },
        ]}
        pointerEvents={screen === 'library' ? 'auto' : 'none'}
      >
        {/* Library header — selection mode or share button */}
        {selectionMode ? (
          <View style={styles.selectionHeader}>
            <TouchableOpacity
              style={styles.selectionCancelButton}
              onPress={cancelSelection}
              activeOpacity={0.8}
            >
              <Text style={styles.selectionCancelText}>Cancel</Text>
            </TouchableOpacity>
            {selectedForSubmit.length > 0 ? (
              <TouchableOpacity
                style={styles.selectionSubmitButton}
                onPress={openMultiSubmitModal}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#0ad86d', '#08a555']}
                  start={{x: 0, y: 0}}
                  end={{x: 1, y: 0}}
                  style={styles.selectionSubmitGradient}
                >
                  <Text style={styles.selectionSubmitText}>Submit {selectedForSubmit.length}</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <Text style={styles.selectionHintText}>select videos below</Text>
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => {
              if (videos.length === 0) {
                Alert.alert('No Videos', 'Compress a video first, then submit it to Small File TV!');
              } else {
                enableSelectionMode();
              }
            }}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#0ad86d', '#08a555']}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={styles.shareButtonGradient}
            >
              <TvIcon color="#000" size={18} />
              <Text style={styles.shareButtonText}>  SHARE TO SMALL FILE TV</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Segmented pixel progress meter */}
        {compressing && (
          <View style={styles.progressContainer}>
            <View style={styles.progressRow}>
              <View style={styles.progressSegments}>
                {Array.from({ length: 24 }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.progressSegment,
                      i < Math.round(progress * 24) && styles.progressSegmentFilled,
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.progressLabel}>{Math.round(progress * 100)}%</Text>
            </View>
          </View>
        )}

        {showSuccess && (
          <Animated.View
            style={[styles.successOverlay, { transform: [{ scale: checkmarkScale }] }]}
          >
            <Text style={styles.successCheck}>✓</Text>
          </Animated.View>
        )}

        <ScrollView style={styles.videoList} contentContainerStyle={styles.videoListContent}>
          {videos.length > 0 && (
            <Text style={styles.sectionTitle}>
              {videos.length} compressed{totalSaved > 0 ? ` · ${formatSize(totalSaved)} saved` : ''}
            </Text>
          )}

          {compressing && (
            <SkeletonPulse>
              <View style={styles.skeletonEntry}>
                <View style={styles.skeletonThumb} />
                <View style={styles.skeletonLines}>
                  <View style={styles.skeletonLine} />
                  <View style={[styles.skeletonLine, { width: '60%' }]} />
                  <View style={[styles.skeletonLine, { width: '40%' }]} />
                </View>
              </View>
            </SkeletonPulse>
          )}

          {videos.map(video => (
            <Animated.View
              key={video.id}
              style={[styles.videoItem, video.expired && styles.videoItemExpired, { opacity: fadeAnims[video.id] || 1 }]}
            >
              <View style={styles.videoRow}>
                {selectionMode && (
                  <TouchableOpacity
                    style={styles.checkbox}
                    onPress={() => toggleVideoSelection(video.id)}
                    disabled={video.submitted}
                  >
                    <View style={[
                      styles.checkboxInner,
                      selectedForSubmit.includes(video.id) && styles.checkboxSelected,
                      video.submitted && styles.checkboxDisabled,
                    ]}>
                      {selectedForSubmit.includes(video.id) && (
                        <Text style={styles.checkboxCheck}>✓</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.videoContent}
                  onPress={() => {
                    if (video.expired) {
                      dismissExpiredVideo(video.id);
                    } else if (selectionMode) {
                      if (!video.submitted) toggleVideoSelection(video.id);
                    } else {
                      handleLongPress(video.id);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.videoInfoRow}>
                    {video.thumbnail && (
                      <Image
                        source={{ uri: `file://${video.thumbnail}` }}
                        style={styles.thumbnail}
                        resizeMode="cover"
                      />
                    )}
                    <View style={styles.videoMetadata}>
                      <View style={styles.videoHeader}>
                        <Text style={styles.videoDate}>
                          {new Date(video.timestamp).toLocaleDateString()}
                        </Text>
                        <Text style={styles.videoSize}>
                          {formatSize(video.compressedSize)}
                        </Text>
                      </View>
                      <Text style={styles.videoReduction}>
                        {getReductionPercentage(video)}% smaller · {video.mode}
                      </Text>
                      <Text style={styles.videoOriginalSize}>
                        Original: {formatSize(video.originalSize)}
                      </Text>
                      {!video.expired && (
                        <Text style={[
                          styles.expiryWarning,
                          getDaysUntilExpiry(video.expiresAt) <= 2 && styles.expiryUrgent,
                        ]}>
                          deletes in {getDaysUntilExpiry(video.expiresAt)}d
                        </Text>
                      )}
                      {video.expired ? (
                        <Text style={styles.expiredBadge}>expired · tap to remove</Text>
                      ) : video.submitted ? (
                        <Text style={styles.submitted}>✓ submitted</Text>
                      ) : null}
                    </View>
                  </View>
                  {!video.expired && (
                    <Text style={styles.longPressHint}>Tap for options</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Animated.View>
          ))}

          {videos.length === 0 && !compressing && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No squished videos yet</Text>
              <Text style={styles.emptySubtext}>Tap SQUISH VIDEO below to compress your first clip</Text>
            </View>
          )}
        </ScrollView>

        {/* Library bottom bar */}
        <View style={styles.libraryBottomBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={navigateToMain}
            activeOpacity={0.8}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          {compressing ? (
            <TouchableOpacity
              style={styles.cancelCompressionButton}
              onPress={cancelCompression}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelCompressionText}>CANCEL</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.squishButtonSmall}
              onPress={selectAndCompressVideo}
              activeOpacity={0.85}
            >
              <Text style={styles.squishButtonSmallText}>SQUISH VIDEO</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* ── MODALS (shared) ── */}
      <Modal
        visible={showContextMenu}
        animationType="fade"
        transparent={true}
        onRequestClose={closeContextMenu}
      >
        <TouchableOpacity
          style={styles.contextOverlay}
          activeOpacity={1}
          onPress={closeContextMenu}
        >
          <View style={styles.contextMenu}>
            <TouchableOpacity style={styles.contextOption} onPress={shareVideo}>
              <Text style={styles.contextText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contextOption} onPress={saveToGallery}>
              <Text style={styles.contextText}>Save to Photos</Text>
            </TouchableOpacity>
            {!videos.find(v => v.id === selectedVideo)?.submitted && (
              <TouchableOpacity style={styles.contextOption} onPress={openSingleSubmitModal}>
                <Text style={styles.contextText}>Submit to Small File TV</Text>
              </TouchableOpacity>
            )}
            <View style={styles.contextDivider} />
            <TouchableOpacity style={styles.contextOption} onPress={deleteVideo}>
              <Text style={[styles.contextText, styles.contextDelete]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showModeSelector}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModeSelector(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Choose Compression</Text>
            <Text style={styles.modalDescription}>
              All modes stay at or below 1.44 MB/min
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {COMPRESSION_MODES.map((mode, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.modeOption}
                  onPress={() => startCompression(mode)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modeName}>{mode.name.toUpperCase()}</Text>
                  <Text style={styles.modeDescription}>{mode.description}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.modeOption, styles.customEntry]}
                onPress={() => { setShowModeSelector(false); setShowCustomPanel(true); }}
                activeOpacity={0.7}
              >
                <Text style={styles.customEntryName}>CUSTOM +</Text>
                <Text style={styles.modeDescription}>dial in your own squish</Text>
              </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowModeSelector(false)}
            >
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showCustomPanel}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCustomPanel(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Custom Squish</Text>
              <Text style={styles.customPreviewName}>
                {nameCustomCombo(customRes, customBitrate, customAudio)}
              </Text>

              <Text style={styles.knobLabel}>Resolution</Text>
              <View style={styles.knobRow}>
                {RES_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.knobChip, customRes === opt.value && styles.knobChipActive]}
                    onPress={() => setCustomRes(opt.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.knobChipText, customRes === opt.value && styles.knobChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.knobLabel}>Bitrate</Text>
              <View style={styles.knobRow}>
                {BITRATE_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.knobChip, customBitrate === opt.value && styles.knobChipActive]}
                    onPress={() => setCustomBitrate(opt.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.knobChipText, customBitrate === opt.value && styles.knobChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.knobLabel}>Audio</Text>
              <View style={styles.knobRow}>
                <TouchableOpacity
                  style={[styles.knobChip, customAudio && styles.knobChipActive]}
                  onPress={() => setCustomAudio(true)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.knobChipText, customAudio && styles.knobChipTextActive]}>On</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.knobChip, !customAudio && styles.knobChipActive]}
                  onPress={() => setCustomAudio(false)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.knobChipText, !customAudio && styles.knobChipTextActive]}>Silent</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.knobLabelMuted}>Frame rate</Text>
              <View style={styles.knobRow}>
                <View style={[styles.knobChip, styles.knobChipDisabled]}>
                  <Text style={styles.knobChipDisabledText}>coming soon</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.customRunButton}
                onPress={runCustomCompression}
                activeOpacity={0.85}
              >
                <Text style={styles.customRunText}>SQUISH</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => { setShowCustomPanel(false); setShowModeSelector(true); }}
              >
                <Text style={styles.modalCancelButtonText}>Back</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSubmitModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => !uploading && setShowSubmitModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Submit to Small File TV</Text>
              <Text style={styles.modalDescription}>
                Submitting {selectedForSubmit.length} video{selectedForSubmit.length > 1 ? 's' : ''} for review at smallfile.tv,
                a showcase for creative, low bitrate content proving you don't need big files to tell great stories.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Name"
                placeholderTextColor="#666"
                value={submissionForm.name}
                onChangeText={(text) => setSubmissionForm({...submissionForm, name: text})}
                editable={!uploading}
              />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#666"
                keyboardType="email-address"
                autoCapitalize="none"
                value={submissionForm.email}
                onChangeText={(text) => setSubmissionForm({...submissionForm, email: text})}
                editable={!uploading}
              />
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Additional details (optional)"
                placeholderTextColor="#666"
                multiline
                numberOfLines={4}
                value={submissionForm.details}
                onChangeText={(text) => setSubmissionForm({...submissionForm, details: text})}
                editable={!uploading}
              />
              <TouchableOpacity
                style={styles.consentContainer}
                onPress={() => setAgreedToTerms(!agreedToTerms)}
                activeOpacity={0.7}
                disabled={uploading}
              >
                <View style={[
                  styles.consentCheckbox,
                  agreedToTerms && styles.consentCheckboxChecked,
                ]}>
                  {agreedToTerms && <Text style={styles.consentCheck}>✓</Text>}
                </View>
                <Text style={styles.consentText}>
                  I agree that my video may be shown on smallfile.tv and understand that 
                  Small File Media Society does not profit from submissions.
                </Text>
              </TouchableOpacity>
              {uploading && (
                <View style={styles.uploadProgressContainer}>
                  <Text style={styles.uploadingText}>
                    Uploading video {currentUploadIndex} of {selectedForSubmit.length}... {Math.round(uploadProgress * 100)}%
                  </Text>
                  <View style={styles.uploadProgressBar}>
                    <View style={[styles.uploadProgressFill, { width: `${uploadProgress * 100}%` }]} />
                  </View>
                </View>
              )}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalButton}
                  onPress={() => { setShowSubmitModal(false); setSelectedForSubmit([]); }}
                  disabled={uploading}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, uploading && styles.buttonDisabled]}
                  onPress={submitVideos}
                  disabled={uploading}
                >
                  {uploading ? (
                    <ActivityIndicator color="#0ad86d" size="small" />
                  ) : (
                    <Text style={styles.modalButtonText}>Submit</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>



      {/* ── ABOUT SCREEN ── */}
      <Animated.View
        style={[
          styles.screenAbout,
          {
            opacity: aboutOpacity,
            transform: [{ translateX: aboutSlide }],
          },
        ]}
        pointerEvents={screen === 'about' ? 'auto' : 'none'}
      >
        <View style={styles.header}>
          <Text style={styles.title}>ABOUT</Text>
        </View>

        <ScrollView style={styles.aboutScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.aboutSection}>PIXEL SQUISHER</Text>
          <Text style={styles.aboutText}>
            {'Version 1.0.0\nA Small File Media Society project\n\nPixel Squisher is a free alternative to typical compression apps, built to help anyone quickly compress video to or below the Small File standard (1.44 MB/min), entirely on-device. No data centers, no edge servers, no internet required. Compress locally and submit your favourite clips directly to Small File TV.'
              + (APP_SIZE_MB > 0 ? `\n\nThe entire app is under ${APP_SIZE_MB} MB. Smaller than ten seconds of 4K video.` : '')
              + (totalSaved > 0 ? `\n\nYour squishes have saved ${formatSize(totalSaved)} of data so far.` : '')}
          </Text>
          <Text style={styles.aboutSection}>Small File Media Society</Text>
          <Text style={styles.aboutText}>
            Founded in 2020 to raise awareness of the high carbon footprint of streaming media. 
            We promote Small-File Ecomedia: low-bandwidth movies of no more than 1.44 megabytes per minute, 
            a tiny fraction of standard video (60-350 MB/min).
          </Text>
          <Text style={styles.aboutSection}>Why Small Files?</Text>
          <Text style={styles.aboutText}>
            Digital media and the infrastructures that support it contribute 5% of greenhouse gas emissions, 
            double those of the airline industry. Data centers, networks, and devices that store, transmit, 
            and play video are a big part of this massive carbon footprint. Small files travel on 2G networks 
            and prove great cinema doesn't need big files!
          </Text>
          <Text style={styles.aboutSection}>Learn More</Text>
          <Text style={styles.aboutText}>
            {'smallfile.ca\ninfo@smallfile.ca'}
          </Text>
          <Text
            style={styles.aboutLink}
            onPress={() => Linking.openURL('https://smallfile.ca/policy/')}
          >
            Privacy Policy
          </Text>
          <Text style={styles.aboutSection}>Acknowledgements</Text>
          <Text style={[styles.aboutText, styles.aboutLast]}>
            The Small File Media Festival runs in partnership with The Cinematheque, Vancouver, 
            on unceded territory of the Sḵwx̱wú7mesh (Squamish), Stó:lō, Səl̰ílwətaʔ/Selilwitulh 
            {'(Tsleil-Waututh) and xʷməθkʷəy̱əm (Musqueam) nations.\n\nSupported by: Canada Council for the Arts, BC Arts Council, Social Sciences and Humanities Research Council of Canada, SFU School for the Contemporary Arts.'}
          </Text>
        </ScrollView>

        <View style={[styles.libraryBottomBar, { justifyContent: 'flex-end' }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={navigateFromAbout}
            activeOpacity={0.8}
          >
            <Text style={styles.backButtonText}>Back →</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ── PIXEL DISSOLVE OVERLAY ── */}
      {!pixelsDone && (
        <View style={styles.pixelGrid} pointerEvents="none">
          {Array.from({ length: TOTAL }, (_, i) => (
            <DissolvePixel key={i} color={PIXEL_COLORS[i % PIXEL_COLORS.length]} />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // ── Shared ──
  pixelGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: S_W + PIXEL_SIZE,
    height: S_H + PIXEL_SIZE,
    flexDirection: 'row',
    flexWrap: 'wrap',
    zIndex: 999,
    overflow: 'hidden',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },

  // ── Main screen ──
  screenMain: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    flexDirection: 'column',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 70 : 52,
    paddingBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '400',
    color: '#0ad86d',
    letterSpacing: 2,
    fontFamily: 'Redaction50-Regular',
    textAlign: 'center',
  },
  mainCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squishButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowPixelGrid: {
    position: 'absolute',
    width: 300,
    height: 300,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  squishButtonText: {
    color: '#000',
    fontSize: 28,
    fontWeight: '400',
    letterSpacing: 2,
    fontFamily: 'Redaction50-Regular',
    textAlign: 'center',
    lineHeight: 36,
  },
  mainNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingBottom: 40,
    paddingTop: 16,
  },
  navButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0ad86d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },

  // ── Library screen ──
  screenAbout: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    flexDirection: 'column',
  },
  aboutScroll: {
    flex: 1,
    paddingHorizontal: 24,
  },
  aboutLink: {
    fontSize: 14,
    color: '#0ad86d',
    textDecorationLine: 'underline',
    marginTop: 8,
    fontWeight: '300',
  },
  aboutLast: {
    marginBottom: 32,
  },
  screenLibrary: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    flexDirection: 'column',
  },
  shareButton: {
    marginTop: Platform.OS === 'ios' ? 54 : 36,
    overflow: 'hidden',
  },
  shareButtonGradient: {
    flexDirection: 'row',
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
    letterSpacing: 1,
  },
  selectionHeader: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 70 : 52,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectionCancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#666',
    borderRadius: 8,
  },
  selectionCancelText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '400',
  },
  selectionSubmitButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  selectionSubmitGradient: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  selectionSubmitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  selectionHintText: {
    fontSize: 12,
    color: '#555',
    letterSpacing: 0.5,
  },
  libraryBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: '#111',
  },
  backButton: {
    height: 46,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '400',
  },
  cancelCompressionButton: {
    backgroundColor: '#c0392b',
    height: 46,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelCompressionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 1,
    fontFamily: 'Redaction50-Regular',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 32,
  },
  emptySubtext: {
    textAlign: 'center',
    color: '#444',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '300',
    letterSpacing: 0.5,
  },
  squishButtonSmall: {
    backgroundColor: '#fff',
    height: 46,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squishButtonSmallText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 1,
    fontFamily: 'Redaction50-Regular',
  },

  // ── Progress ──
  progressContainer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressSegments: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
    marginRight: 10,
  },
  progressSegment: {
    flex: 1,
    height: 8,
    backgroundColor: '#161616',
  },
  progressSegmentFilled: {
    backgroundColor: '#0ad86d',
  },
  progressLabel: {
    fontSize: 12,
    color: '#0ad86d',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
    minWidth: 38,
    textAlign: 'right',
  },

  // ── Success overlay ──
  successOverlay: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    marginLeft: -50,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#0ad86d',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  successCheck: {
    fontSize: 60,
    color: '#000',
    fontWeight: 'bold',
  },

  // ── Video list ──
  videoList: {
    flex: 1,
  },
  videoListContent: {
    padding: 24,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
    textTransform: 'lowercase',
    letterSpacing: 1,
  },
  videoItem: {
    borderTopWidth: 1,
    borderTopColor: '#0ad86d',
    paddingVertical: 20,
  },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    marginRight: 12,
    marginTop: 2,
  },
  checkboxInner: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#0ad86d',
    borderColor: '#0ad86d',
  },
  checkboxDisabled: {
    backgroundColor: '#333',
    borderColor: '#333',
  },
  checkboxCheck: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  videoContent: {
    flex: 1,
  },
  videoInfoRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  thumbnail: {
    width: 80,
    height: 80,
    backgroundColor: '#222',
    marginRight: 12,
    borderRadius: 4,
  },
  videoMetadata: {
    flex: 1,
    justifyContent: 'center',
  },
  videoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  videoDate: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '400',
  },
  videoSize: {
    fontSize: 13,
    color: '#999',
    fontWeight: '300',
  },
  videoReduction: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  videoOriginalSize: {
    fontSize: 10,
    color: '#555',
    marginTop: 1,
  },
  expiryWarning: {
    fontSize: 10,
    color: '#555',
    marginTop: 2,
  },
  expiryUrgent: {
    color: '#944',
  },
  submitted: {
    fontSize: 11,
    color: '#0ad86d',
    marginTop: 4,
  },
  longPressHint: {
    fontSize: 9,
    color: '#444',
    marginTop: 4,
    fontStyle: 'italic',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 14,
    marginTop: 40,
    fontWeight: '300',
  },
  skeletonEntry: {
    flexDirection: 'row',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#0ad86d',
  },
  skeletonThumb: {
    width: 80,
    height: 80,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    marginRight: 12,
  },
  skeletonLines: {
    flex: 1,
    justifyContent: 'center',
    gap: 8,
  },
  skeletonLine: {
    height: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
  },
  videoItemExpired: {
    opacity: 0.4,
  },
  expiredBadge: {
    fontSize: 10,
    color: '#944',
    marginTop: 4,
    fontStyle: 'italic',
  },

  // ── Shared button bits ──
  buttonDisabled: {
    backgroundColor: '#333',
  },

  // ── Context menu ──
  contextOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contextMenu: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#0ad86d',
    minWidth: 250,
  },
  contextOption: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  contextText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '300',
  },
  contextDelete: {
    color: '#f44',
  },
  contextDivider: {
    height: 1,
    backgroundColor: '#0ad86d',
  },

  // ── Modals ──
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#0ad86d',
    padding: 24,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '400',
    marginBottom: 16,
    color: '#0ad86d',
    letterSpacing: 1,
    fontFamily: 'Redaction50-Regular',
  },
  modalDescription: {
    fontSize: 14,
    color: '#999',
    marginBottom: 24,
    lineHeight: 22,
    fontWeight: '300',
  },
  customEntry: {
    borderTopWidth: 1,
    borderTopColor: '#0ad86d',
    marginTop: 4,
  },
  customEntryName: {
    fontSize: 18,
    color: '#0ad86d',
    fontWeight: '400',
    marginBottom: 4,
    letterSpacing: 1,
    fontFamily: 'Redaction50-Regular',
  },
  customPreviewName: {
    fontSize: 22,
    color: '#0ad86d',
    fontFamily: 'Redaction50-Regular',
    letterSpacing: 1,
    marginBottom: 20,
  },
  knobLabel: {
    fontSize: 11,
    color: '#888',
    textTransform: 'lowercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  knobLabelMuted: {
    fontSize: 11,
    color: '#444',
    textTransform: 'lowercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  knobRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  knobChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    backgroundColor: '#000',
  },
  knobChipActive: {
    backgroundColor: '#0ad86d',
    borderColor: '#0ad86d',
  },
  knobChipText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '400',
  },
  knobChipTextActive: {
    color: '#000',
  },
  knobChipDisabled: {
    borderColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  knobChipDisabledText: {
    color: '#333',
    fontSize: 13,
    fontStyle: 'italic',
  },
  customRunButton: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 28,
  },
  customRunText: {
    color: '#000',
    fontSize: 20,
    letterSpacing: 2,
    fontFamily: 'Redaction50-Regular',
  },
  modeOption: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  modeName: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '300',
    marginBottom: 4,
  },
  modeDescription: {
    fontSize: 13,
    color: '#999',
    fontWeight: '300',
  },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 0,
    padding: 14,
    fontSize: 15,
    backgroundColor: '#000',
    color: '#fff',
    marginBottom: 12,
    fontWeight: '300',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  uploadProgressContainer: {
    marginVertical: 16,
  },
  uploadingText: {
    color: '#0ad86d',
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
  uploadProgressBar: {
    height: 4,
    backgroundColor: '#222',
    borderRadius: 2,
    overflow: 'hidden',
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: '#0ad86d',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#0ad86d',
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: '#111',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#0ad86d',
    letterSpacing: 1,
    textTransform: 'lowercase',
  },
  modalCancelButton: {
    width: '100%',
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#0ad86d',
    backgroundColor: '#111',
    alignItems: 'center',
    marginTop: 12,
  },
  modalCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0ad86d',
    letterSpacing: 1,
    textTransform: 'lowercase',
  },
  consentContainer: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  consentCheckbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#666',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  consentCheckboxChecked: {
    backgroundColor: '#0ad86d',
    borderColor: '#0ad86d',
  },
  consentCheck: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  consentText: {
    flex: 1,
    fontSize: 13,
    color: '#aaa',
    lineHeight: 20,
  },
  aboutSection: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0ad86d',
    marginTop: 20,
    marginBottom: 8,
  },
  aboutText: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 22,
    fontWeight: '300',
  },
});

export default App;