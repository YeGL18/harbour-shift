#import "HarbourSound.h"
#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#include <math.h>

@interface HarbourSound () <AVAudioPlayerDelegate>
@property (nonatomic, strong) AVAudioPlayer *offerPlayer;
@property (nonatomic, strong) AVAudioPlayer *acceptedPlayer;
@property (nonatomic, strong) NSMutableDictionary<NSString *, AVAudioPlayer *> *cuePlayers;
@property (nonatomic, strong) AVAudioPlayer *currentCuePlayer;
@property (nonatomic, strong) NSMutableDictionary<NSString *, AVAudioPlayer *> *hornPlayers;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *hornStarts;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSObject *> *hornLeases;
@property (nonatomic, assign) BOOL enabled;
@property (nonatomic, assign) BOOL invalidated;
@property (nonatomic, assign) BOOL inBackground;
@end

@implementation HarbourSound

RCT_EXPORT_MODULE(HarbourSound)

+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (instancetype)init
{
  if ((self = [super init])) {
    _enabled = YES;
    _inBackground = [UIApplication sharedApplication].applicationState == UIApplicationStateBackground;
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(appDidEnterBackground:) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(appWillEnterForeground:) name:UIApplicationWillEnterForegroundNotification object:nil];
  }
  return self;
}

- (AVAudioPlayer *)playerForResource:(NSString *)name loops:(NSInteger)loops directory:(NSString *)directory
{
  NSURL *url = [[NSBundle mainBundle] URLForResource:name withExtension:@"wav" subdirectory:directory];
  if (!url) return nil;
  NSError *error = nil;
  AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithContentsOfURL:url error:&error];
  if (!player || error) return nil;
  player.numberOfLoops = loops;
  player.delegate = self;
  [player prepareToPlay];
  return player;
}

- (AVAudioPlayer *)playerForResource:(NSString *)name loops:(NSInteger)loops
{
  return [self playerForResource:name loops:loops directory:nil];
}

- (void)stopUICues
{
  for (AVAudioPlayer *player in self.cuePlayers.allValues) {
    [player stop];
    player.currentTime = 0;
  }
  self.currentCuePlayer = nil;
}

- (void)appDidEnterBackground:(NSNotification *)notification
{
  self.inBackground = YES;
  [self stopAllHornsNow];
  [self stopUICues];
  [self deactivateIfIdle];
}

- (void)appWillEnterForeground:(NSNotification *)notification
{
  self.inBackground = NO;
}

- (BOOL)activateAudio
{
  NSError *error = nil;
  AVAudioSession *session = [AVAudioSession sharedInstance];
  // Ambient respects the Ring/Silent switch; other audio keeps playing.
  if (![session setCategory:AVAudioSessionCategoryAmbient
                       mode:AVAudioSessionModeDefault
                    options:0
                      error:&error]) return NO;
  return [session setActive:YES error:&error];
}

- (void)deactivateIfIdle
{
  if (self.offerPlayer.isPlaying || self.acceptedPlayer.isPlaying) return;
  for (AVAudioPlayer *player in self.cuePlayers.allValues) if (player.isPlaying) return;
  for (AVAudioPlayer *player in self.hornPlayers.allValues) if (player.isPlaying) return;
  [[AVAudioSession sharedInstance] setActive:NO
                               withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                     error:nil];
}

RCT_EXPORT_METHOD(playOffer)
{
  if (!self.enabled || self.invalidated || self.offerPlayer.isPlaying) return;
  [self stopUICues];
  if (!self.offerPlayer) self.offerPlayer = [self playerForResource:@"harbour_offer" loops:-1];
  if (!self.offerPlayer || ![self activateAudio]) return;
  self.offerPlayer.currentTime = 0;
  BOOL playing = [self.offerPlayer play];
  NSLog(@"[HarbourSound] offer playing=%d", playing);
}

RCT_EXPORT_METHOD(stopOffer)
{
  // The success sound owns a separate player and must survive this call.
  [self.offerPlayer stop];
  self.offerPlayer.currentTime = 0;
  [self deactivateIfIdle];
}

RCT_EXPORT_METHOD(playAccepted)
{
  if (!self.enabled || self.invalidated) return;
  [self stopUICues];
  [self.offerPlayer stop];
  self.offerPlayer.currentTime = 0;
  if (!self.acceptedPlayer) self.acceptedPlayer = [self playerForResource:@"harbour_accept" loops:0];
  if (!self.acceptedPlayer || ![self activateAudio]) return;
  [self.acceptedPlayer stop];
  self.acceptedPlayer.currentTime = 0;
  BOOL playing = [self.acceptedPlayer play];
  NSLog(@"[HarbourSound] accepted playing=%d", playing);
}

RCT_EXPORT_METHOD(playCue:(NSString *)name)
{
  static NSSet<NSString *> *allowed;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    allowed = [NSSet setWithArray:@[@"tap", @"select", @"open", @"pause", @"resume", @"park", @"rest", @"service", @"complete", @"cancel", @"error", @"event"]];
  });
  if (![name isKindOfClass:[NSString class]] || ![allowed containsObject:name] || self.invalidated) return;
  BOOL isPause = [name isEqualToString:@"pause"];
  if (isPause) {
    // Pause explicitly cancels an outstanding offer sound before its UI cue.
    [self.offerPlayer stop];
    self.offerPlayer.currentTime = 0;
  }
  if (!self.enabled || self.inBackground || self.offerPlayer.isPlaying || self.acceptedPlayer.isPlaying) {
    if (isPause) [self deactivateIfIdle];
    return;
  }
  [self stopUICues];
  if (!self.cuePlayers) self.cuePlayers = [NSMutableDictionary dictionary];
  AVAudioPlayer *player = self.cuePlayers[name];
  if (!player) {
    player = [self playerForResource:[@"harbour_" stringByAppendingString:name] loops:0 directory:@"sounds"];
    if (player) {
      player.volume = 0.35;
      self.cuePlayers[name] = player;
    }
  }
  if (!player || ![self activateAudio]) {
    [self deactivateIfIdle];
    return;
  }
  player.currentTime = 0;
  BOOL playing = [player play];
  self.currentCuePlayer = playing ? player : nil;
  if (isPause) NSLog(@"[HarbourSound] cue=pause playing=%d", playing && player.isPlaying);
  else if ([name isEqualToString:@"resume"]) NSLog(@"[HarbourSound] cue=resume playing=%d", playing && player.isPlaying);
  if (!playing) [self deactivateIfIdle];
}

RCT_EXPORT_METHOD(setEnabled:(BOOL)enabled)
{
  _enabled = enabled;
  if (!enabled) {
    [self stopAllHornsNow];
    [self.offerPlayer stop];
    self.offerPlayer.currentTime = 0;
    [self.acceptedPlayer stop];
    self.acceptedPlayer.currentTime = 0;
    [self stopUICues];
    [self deactivateIfIdle];
  }
}

- (void)stopHornNow:(NSString *)identifier
{
  AVAudioPlayer *player = self.hornPlayers[identifier];
  [player stop]; player.delegate = nil;
  [self.hornPlayers removeObjectForKey:identifier];
  [self.hornStarts removeObjectForKey:identifier];
  [self.hornLeases removeObjectForKey:identifier];
  [self deactivateIfIdle];
}

- (void)stopAllHornsNow
{
  for (NSString *identifier in self.hornPlayers.allKeys) [self stopHornNow:identifier];
}

RCT_EXPORT_METHOD(startHorn:(NSString *)identifier gain:(double)gain)
{
  if (![identifier isKindOfClass:[NSString class]] || identifier.length == 0 || identifier.length > 160 || !isfinite(gain) || !self.enabled || self.invalidated || self.inBackground) return;
  NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:_-"] invertedSet];
  if ([identifier rangeOfCharacterFromSet:invalid].location != NSNotFound) return;
  if (!self.hornPlayers) { self.hornPlayers = [NSMutableDictionary dictionary]; self.hornStarts = [NSMutableDictionary dictionary]; self.hornLeases = [NSMutableDictionary dictionary]; }
  AVAudioPlayer *player = self.hornPlayers[identifier];
  if (!player) {
    if (self.hornPlayers.count >= 16) [self stopHornNow:self.hornPlayers.allKeys.firstObject];
    player = [self playerForResource:@"harbour_horn" loops:-1 directory:@"sounds"];
    if (!player || ![self activateAudio]) return;
    self.hornPlayers[identifier] = player;
    self.hornStarts[identifier] = @(CACurrentMediaTime());
    player.volume = 0.27 * MAX(0, MIN(1, gain));
    if (![player play]) { [self stopHornNow:identifier]; return; }
    NSLog(@"[HarbourSound] horn playing=1");
  } else player.volume = 0.27 * MAX(0, MIN(1, gain));
  NSObject *lease = [NSObject new];
  self.hornLeases[identifier] = lease;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (self.hornLeases[identifier] == lease) [self stopHornNow:identifier];
  });
}

RCT_EXPORT_METHOD(stopHorn:(NSString *)identifier)
{
  AVAudioPlayer *player = self.hornPlayers[identifier]; if (!player) return;
  NSTimeInterval remaining = MAX(0, 0.3 - (CACurrentMediaTime() - self.hornStarts[identifier].doubleValue));
  NSObject *lease = self.hornLeases[identifier];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(remaining * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (self.hornPlayers[identifier] == player && self.hornLeases[identifier] == lease) [self stopHornNow:identifier];
  });
}

RCT_EXPORT_METHOD(stopAllHorns) { [self stopAllHornsNow]; }

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag
{
  // An old completion callback must not clear a cue that just restarted using
  // the same cached player. The actual playing state remains authoritative.
  if (player == self.currentCuePlayer && !player.isPlaying) self.currentCuePlayer = nil;
  [self deactivateIfIdle];
}

- (void)audioPlayerDecodeErrorDidOccur:(AVAudioPlayer *)player error:(NSError *)error
{
  if (player == self.currentCuePlayer) {
    [player stop];
    self.currentCuePlayer = nil;
  }
  [self deactivateIfIdle];
}

- (void)invalidate
{
  void (^cleanup)(void) = ^{
    self.invalidated = YES;
    _enabled = NO;
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [self stopAllHornsNow];
    [self stopUICues];
    [self.offerPlayer stop];
    [self.acceptedPlayer stop];
    self.offerPlayer.delegate = nil;
    self.acceptedPlayer.delegate = nil;
    for (AVAudioPlayer *player in self.cuePlayers.allValues) player.delegate = nil;
    [self.cuePlayers removeAllObjects];
    self.cuePlayers = nil;
    self.offerPlayer = nil;
    self.acceptedPlayer = nil;
    [self deactivateIfIdle];
  };
  if ([NSThread isMainThread]) cleanup();
  else dispatch_async(dispatch_get_main_queue(), cleanup);
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
