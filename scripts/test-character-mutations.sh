#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d /tmp/mouju-character-mutations.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/lib" "$TMP/tests" "$TMP/out"
cp "$ROOT/lib/game-v2-data.ts" "$TMP/lib/game-v2-data.ts"
cp "$ROOT/tests/character-deep-interactions.test.ts" "$TMP/tests/character-deep-interactions.test.ts"
cp "$ROOT/tests/character-exhaustive-edge.test.ts" "$TMP/tests/character-exhaustive-edge.test.ts"
cp "$ROOT/tests/character-locked-lord-edge.test.ts" "$TMP/tests/character-locked-lord-edge.test.ts"
cp "$ROOT/tests/character-combinatorial-matrix.test.ts" "$TMP/tests/character-combinatorial-matrix.test.ts"
cp "$ROOT/tests/equipment-character-interactions.test.ts" "$TMP/tests/equipment-character-interactions.test.ts"

ESBUILD="$ROOT/node_modules/.bin/esbuild"
if [[ ! -x "$ESBUILD" ]]; then
  echo "Mutation gate requires the installed esbuild binary." >&2
  exit 1
fi

mutate() {
  local name="$1"
  local target="$TMP/lib/game-v2.ts"
  case "$name" in
    damage_epoch)
      perl -0pi -e 's/if \(data\.damage\.targetEpoch !== undefined && data\.damage\.targetEpoch !== target\.generalEpoch\) return;/if (false) return;/' "$target"
      ;;
    yiji_damage_count)
      perl -0pi -e 's/Array\.from\(\{ length: data\.damage\.amount \}/Array.from({ length: 1 }/' "$target"
      ;;
    guanxing_empty)
      perl -0pi -e 's/if \(cards\.length === 0\) \{/if (false) {/' "$target"
      ;;
    biyue_decline)
      perl -0pi -e 's/\n    && !state\.turn!\.usedSkills\.includes\("biyue:phase"\)//' "$target"
      ;;
    keji_sha_guard)
      perl -0pi -e 's/&& !state\.turn!\.stats\.shaUsedOrPlayed/&& true/' "$target"
      ;;
    qianxun_target)
      perl -0pi -e 's/if \(hasSkill\(target, "qianxun"\)/if (false \&\& hasSkill(target, "qianxun")/' "$target"
      ;;
    kongcheng_target)
      perl -0pi -e 's/if \(hasSkill\(target, "kongcheng"\)/if (false \&\& hasSkill(target, "kongcheng")/' "$target"
      ;;
    jiuyuan_kingdom)
      perl -0pi -e 's/ && actor\.character\?\.kingdom === "wu"//' "$target"
      ;;
    jiuyuan_duel)
      perl -0pi -e 's/if \(state\.mode !== "duel" && target\.role === "lord" && hasSkill\(target, "jiuyuan"\)/if (target.role === "lord" \&\& hasSkill(target, "jiuyuan")/' "$target"
      ;;
    hujia_retry)
      perl -0pi -e 's/if \(!lordSkillTried && state\.mode !== "duel" && actor\.role === "lord"\)/if (state.mode !== "duel" \&\& actor.role === "lord")/' "$target"
      ;;
    hujia_provider_filter)
      perl -0pi -e 's/\.filter\(\(entry\) => entry\.character\?\.kingdom === kingdom\)/.filter(() => true)/' "$target"
      ;;
    recycle_boundary)
      perl -0pi -e 's/if \(state\.deck\.length > 0 \|\| state\.discard\.length === 0\) return;/if (state.deck.length >= 0 || state.discard.length === 0) return;/' "$target"
      ;;
    wushuang_requirement)
      perl -0pi -e 's/hasSkill\(source, "wushuang"\) \? 2 : 1/1/g' "$target"
      ;;
    zhangba_response_provenance)
      perl -0pi -e 's/const responseSkillName = action\.skill === "zhangba_response"/const responseSkillName = false/' "$target"
      ;;
    zhangba_lord_provenance)
      perl -0pi -e 's/const providerSkillName = action\.skill === "lord_zhangba"/const providerSkillName = false/' "$target"
      ;;
    zhangba_borrow_provenance)
      perl -0pi -e 's/const borrowedSkillName = action\.skill === "zhangba_response"/const borrowedSkillName = false/' "$target"
      ;;
    no_judgment_fallback)
      perl -0pi -e 's/continueWithoutJudgment\(state, targetId, reason, dataAs<JudgmentContinuation>\(continuation\), context\);/void continuation;/' "$target"
      ;;
    luoshen_resume_once)
      perl -0pi -e 's/if \(action\.type !== "pass"\) beginJudgment\(state, actor\.id, "洛神", \{ resume: "luoshen" \}, context\);/if (action.type === "pass") pushFrame(state, "preparePhase"); else beginJudgment(state, actor.id, "洛神", { resume: "luoshen" }, context);/' "$target"
      ;;
    qingguo_hand_only)
      perl -0pi -e 's/required === "闪" && inHand && hasSkill\(actor, "qingguo"\)/required === "闪" \&\& hasSkill(actor, "qingguo")/' "$target"
      ;;
    zhangba_sha_limit)
      perl -0pi -e 's/\n    && \(state\.turn!\.shaUsed < 1 \|\| hasSkill\(actor, "paoxiao"\)\)//' "$target"
      ;;
    play_conversion_provenance)
      perl -0pi -e 's/const sourceSkillName = action\.skill \? SKILLS\[action\.skill as SkillId\]\?\.name : undefined;/const sourceSkillName = undefined;/' "$target"
      ;;
    zhangba_play_provenance)
      perl -0pi -e 's/，将 \$\{publicCardList\(cards\)\} 当【杀】对/，对/' "$target"
      ;;
    lightning_damage_provenance)
      perl -0pi -e 's/const lightningIds = continuation\.cardIds \?\? \[\];/const lightningIds = continuation.cardIds ?? []; discardProcessing(state, lightningIds);/' "$target"
      ;;
    fangtian_conversion_provenance)
      perl -0pi -e 's/skill: option\.skill \?\? "fangtian"/skill: "fangtian"/' "$target"
      ;;
    template_action_type)
      perl -0pi -e 's/if \(action\.type !== expectedType\) throw new Error\("动作类型不合法"\);/if (false) throw new Error("动作类型不合法");/' "$target"
      ;;
    bagua_response_reset)
      perl -0pi -e 's/baguaTried: false/baguaTried: true/' "$target"
      ;;
    liuli_target_order)
      perl -0pi -e 's/if \(!flags\.liuli\) \{/if (false \&\& !flags.liuli) {/' "$target"
      ;;
    liuli_existing_target)
      perl -0pi -e 's/candidate\.id === target\.id \|\| candidate\.id === source\.id/candidate.id === target.id || candidate.id === source.id || use.targets.includes(candidate.id)/' "$target"
      ;;
    identity_turn_cleanup)
      perl -0pi -e 's/state\.turnTerminated = true;\n    const phaseFrames = new Set\(\[[^\n]+\]\);\n    state\.stack = state\.stack\.filter\(\(frame\) => !phaseFrames\.has\(frame\.kind\)\);/state.turnTerminated = true;\n    state.stack = [];/g' "$target"
      ;;
    dead_source_trigger)
      perl -0pi -e 's/source\.alive && hasSkill\(source, "tieqi"\)/hasSkill(source, "tieqi")/' "$target"
      ;;
    exact_action_field_order)
      perl -0pi -e 's/return JSON\.stringify\(canonicalize\(semantic\(left\)\)\) === JSON\.stringify\(canonicalize\(semantic\(right\)\)\);/return JSON.stringify(left) === JSON.stringify(right);/' "$target"
      ;;
    decision_metadata)
      perl -0pi -e 's/const semantic = \(action: GameActionV2\) => Object\.fromEntries\(\n    Object\.entries\(action\)\.filter\(\(\[key\]\) => key !== "decisionId" && key !== "optionId"\),\n  \);/const semantic = (action: GameActionV2) => action;/' "$target"
      ;;
    dead_action_order)
      perl -0pi -e 's/if \(start < 0\) \{\n    const origin = state\.players\.find\(\(entry\) => entry\.id === startingId\);\n    if \(!origin \|\| alive\.length === 0\) return alive;\n    const next = alive\.findIndex\(\(entry\) => entry\.seat > origin\.seat\);\n    const index = next >= 0 \? next : 0;\n    return \[\.\.\.alive\.slice\(index\), \.\.\.alive\.slice\(0, index\)\];\n  \}/if (start < 0) return alive;/' "$target"
      ;;
    victory_transient_cleanup)
      perl -0pi -e 's/state\.discard\.push\(\.\.\.state\.processing\.map\(restorePhysicalCard\), \.\.\.state\.revealed\.map\(restorePhysicalCard\)\);/void state.processing;/g' "$target"
      ;;
    conversion_cost_range)
      perl -0pi -e 's/return from\.equipment\.weapon\?\.id === costId \? 1 : attackRangeV2\(from\);/return attackRangeV2(from);/' "$target"
      ;;
    jizhi_nullification)
      perl -0pi -e 's/mayTriggerJizhi = hasSkill\(actor, "jizhi"\);/mayTriggerJizhi = false;/' "$target"
      ;;
    xiaoji_loss_count)
      perl -0pi -e 's/index < removedEquipment; index \+= 1/index < Math.min(1, removedEquipment); index += 1/' "$target"
      ;;
    dead_wushuang_lifecycle)
      perl -0pi -e 's/source\.alive && hasSkill\(source, "wushuang"\)/hasSkill(source, "wushuang")/g' "$target"
      ;;
    no_judgment_wushuang_default)
      perl -0pi -e 's/(if \(continuation\.resume === "bagua"\) \{\n    const use = continuation\.use!;\n    const source = player\(state, use\.sourceId\);\n    )const required = source\.alive && hasSkill\(source, "wushuang"\) \? 2 : 1;/${1}const required = 2;/' "$target"
      ;;
    dead_duplicate_target)
      perl -0pi -e 's/(function resolveShaEffect\([^\n]+\) \{\n)  if \(!target\.alive\) return;/${1}  if (false) return;/' "$target"
      ;;
    dead_action_order_wrap)
      perl -0pi -e 's/const index = next >= 0 \? next : 0;/const index = next >= 0 ? next : Math.max(0, alive.length - 1);/' "$target"
      ;;
    *)
      echo "Unknown mutant: $name" >&2
      exit 1
      ;;
  esac
}

kill_mutant() {
  local name="$1"
  local test_file="$2"
  local pattern="$3"
  local bundle="$TMP/out/${name}.mjs"
  local log="$TMP/out/${name}.log"
  cp "$ROOT/lib/game-v2.ts" "$TMP/lib/game-v2.ts"
  mutate "$name"
  if cmp -s "$ROOT/lib/game-v2.ts" "$TMP/lib/game-v2.ts"; then
    echo "MUTATION_INVALID=$name (source was unchanged)" >&2
    exit 1
  fi
  if ! "$ESBUILD" "$TMP/tests/$test_file" --bundle --platform=node --format=esm --outfile="$bundle" --log-level=warning >"$log" 2>&1; then
    echo "MUTATION_INVALID=$name (mutant did not compile)" >&2
    sed -n '1,120p' "$log" >&2
    exit 1
  fi
  if node --test --test-name-pattern="$pattern" "$bundle" >"$log" 2>&1; then
    echo "MUTATION_SURVIVED=$name" >&2
    sed -n '1,160p' "$log" >&2
    exit 1
  fi
  echo "MUTATION_KILLED=$name"
}

kill_mutant damage_epoch character-deep-interactions.test.ts "KOF replacement rejects"
kill_mutant yiji_damage_count character-deep-interactions.test.ts "two points of Luoyi"
kill_mutant guanxing_empty character-deep-interactions.test.ts "Guanxing becomes a safe no-op"
kill_mutant biyue_decline character-deep-interactions.test.ts "Keji is offered only"
kill_mutant keji_sha_guard character-deep-interactions.test.ts "Keji is offered only"
kill_mutant qianxun_target character-locked-lord-edge.test.ts "谦逊 blocks"
kill_mutant kongcheng_target character-locked-lord-edge.test.ts "空城 blocks"
kill_mutant jiuyuan_kingdom character-deep-interactions.test.ts "Jiuyuan bonus"
kill_mutant jiuyuan_duel character-deep-interactions.test.ts "Jiuyuan bonus"
kill_mutant hujia_retry character-deep-interactions.test.ts "Hujia visits only"
kill_mutant hujia_provider_filter character-deep-interactions.test.ts "Hujia visits only"
kill_mutant recycle_boundary character-deep-interactions.test.ts "Guanxing and Yiji draw across"
kill_mutant wushuang_requirement character-deep-interactions.test.ts "Wushuang finishes exactly"
kill_mutant zhangba_response_provenance equipment-character-interactions.test.ts "Spear converts exactly two"
kill_mutant zhangba_lord_provenance equipment-character-interactions.test.ts "Spear provenance remains explicit"
kill_mutant zhangba_borrow_provenance equipment-character-interactions.test.ts "Spear provenance remains explicit"
kill_mutant no_judgment_fallback character-deep-interactions.test.ts "every optional judgment path"
kill_mutant luoshen_resume_once character-deep-interactions.test.ts "Luoshen resumes the phase sequence"
kill_mutant qingguo_hand_only character-exhaustive-edge.test.ts "all five general card conversions"
kill_mutant zhangba_sha_limit equipment-character-interactions.test.ts "Spear obeys the normal once-per-turn"
kill_mutant play_conversion_provenance character-exhaustive-edge.test.ts "every play-phase conversion"
kill_mutant zhangba_play_provenance equipment-character-interactions.test.ts "Spear converts exactly two"
kill_mutant lightning_damage_provenance character-deep-interactions.test.ts "Cao Cao may obtain"
kill_mutant fangtian_conversion_provenance equipment-character-interactions.test.ts "Halberd preserves Wusheng"
kill_mutant template_action_type character-deep-interactions.test.ts "template actions reject"
kill_mutant bagua_response_reset equipment-character-interactions.test.ts "Bagua may be used independently"
kill_mutant liuli_target_order character-exhaustive-edge.test.ts "流离 precedes 铁骑"
kill_mutant liuli_existing_target character-exhaustive-edge.test.ts "流离 precedes 铁骑"
kill_mutant identity_turn_cleanup character-deep-interactions.test.ts "identity-turn death by Ganglie"
kill_mutant dead_source_trigger character-deep-interactions.test.ts "Fangtian Sha continues"
kill_mutant exact_action_field_order character-deep-interactions.test.ts "exact legal actions remain valid"
kill_mutant decision_metadata character-deep-interactions.test.ts "matching decisionId"
kill_mutant dead_action_order character-deep-interactions.test.ts "nullification order stays anchored"
kill_mutant victory_transient_cleanup character-deep-interactions.test.ts "victory caused inside Ganglie"
kill_mutant conversion_cost_range character-exhaustive-edge.test.ts "Wusheng recomputes range"
kill_mutant jizhi_nullification character-deep-interactions.test.ts "Jizhi triggered by Nullification"
kill_mutant xiaoji_loss_count character-deep-interactions.test.ts "losing two equipment cards"
kill_mutant dead_wushuang_lifecycle character-deep-interactions.test.ts "dead Wushuang source"
kill_mutant no_judgment_wushuang_default character-deep-interactions.test.ts "every optional judgment path"
kill_mutant dead_duplicate_target character-exhaustive-edge.test.ts "Liuli redirect to an existing"
kill_mutant dead_action_order_wrap character-deep-interactions.test.ts "wraps from the last seat"

echo "CHARACTER_MUTATIONS_KILLED=41"
