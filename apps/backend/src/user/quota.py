"""用量配额的计算与拦截。

配额原来只是显示：`user.daily_token_used` / `monthly_token_used` 全仓库没有任何写入方，
所以恒为 0，界面上「已用 0 · 上限 100,000」是一句假话，改上限也不改变能不能继续对话。

这里刻意**不新增计数字段**，而是从已有的 message 正文现算：

- 计数器需要每一条产出路径都记得累加，漏一条就永久偏低 —— 这正是原来坏掉的原因；
- 现算没有「重置」问题：日/月窗口就是 created_at 的范围条件，不需要 cron、不需要 reset 锚点列；
- 历史消息自动被算进来，不需要回填。

代价是每个请求多一次聚合查询；窗口条件已经把扫描范围限制在当天/当月。
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.client import get_relation_db
from src.user.auth.service import get_current_user, is_admin

# 中日韩字符按 ~1.5 字/token，其余按 ~4 字符/token。
# 这不是精确的 BPE 计数，但它是**唯一**的口径：同一个数字既用于展示也用于拦截，
# 不会出现「界面显示 90%、实际已经被限流」这种两套算法的错缝。
#
# 必须用 raw string —— 这些 \u 是给 PostgreSQL 正则的转义，
# 写成普通字符串会被 Python 先解成字面汉字，字符类范围就悄悄错了。
# Built from chr() at import time. PostgreSQL's ARE has no \uwxyz escape, so a literal
# "\u4e00-\u9fff" pattern matches no Han text at all -- measured: CJK counted 0,
# i.e. every Chinese conversation would have looked like zero usage.
def _char_class(*spans) -> str:
    return "[" + "".join(f"{chr(lo)}-{chr(hi)}" for lo, hi in spans) + "]"


_CJK_CLASS = _char_class(
    (0x3040, 0x30FF),  # Hiragana + Katakana
    (0x3400, 0x4DBF),  # CJK Extension A
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0xAC00, 0xD7AF),  # Hangul syllables
)

_USAGE_SQL = text(
    r"""
    SELECT COALESCE(SUM(
        ceil(
            (length(m.content)
             - length(regexp_replace(m.content, :cjk, '', 'g'))) / 1.5
        ) +
        ceil(
            length(regexp_replace(m.content, :cjk, '', 'g')) / 4.0
        )
    ), 0)::bigint
    FROM message m
    JOIN conversation c ON c.id = m.conversation_id
    WHERE c.user_id = :user_id
      AND m.role = 'assistant'
      AND m.created_at >= date_trunc(:part, now())
    """
)


_USAGE_ALL_SQL = text(
    """
    SELECT COALESCE(SUM(
        ceil(
            (length(m.content)
             - length(regexp_replace(m.content, :cjk, '', 'g'))) / 1.5
        ) +
        ceil(
            length(regexp_replace(m.content, :cjk, '', 'g')) / 4.0
        )
    ), 0)::bigint
    FROM message m
    JOIN conversation c ON c.id = m.conversation_id
    WHERE c.user_id = :user_id
      AND m.role = 'assistant'
    """
)


def is_unlimited(limit) -> bool:
    """None 与 0 都表示「无使用上限」。

    把 0 也当作无限制，而不是「0 额度 = 什么都不能干」：
    界面只提供「无限制」这一个非正数选项，而历史数据里 limit 可能被 PATCH 成 0。
    """
    return limit is None or limit <= 0


async def period_usage(db: AsyncSession, user_id: int, part: str) -> int:
    """某个用户在窗口内的用量。part='all' 表示不限时间。

    `date_trunc('all', now())` 会直接报错，所以总量走另一条没有日期条件的 SQL。
    """
    stmt = _USAGE_ALL_SQL if part == "all" else _USAGE_SQL
    result = await db.execute(
        stmt, {"cjk": _CJK_CLASS, "user_id": user_id, **({} if part == "all" else {"part": part})}
    )
    return int(result.scalar_one_or_none() or 0)


_USAGE_BY_USER_SQL = text(
    """
    SELECT c.user_id, COALESCE(SUM(
        ceil(
            (length(m.content)
             - length(regexp_replace(m.content, :cjk, '', 'g'))) / 1.5
        ) +
        ceil(
            length(regexp_replace(m.content, :cjk, '', 'g')) / 4.0
        )
    ), 0)::bigint AS used
    FROM message m
    JOIN conversation c ON c.id = m.conversation_id
    WHERE m.role = 'assistant'
      -- part='all' 是不限时间的那一档（管理员要看的「总量」）。
      -- date_trunc('all', …) 会直接报错，所以用 CASE 短路，别让它被求值。
      AND (CASE WHEN :part = 'all' THEN TRUE
                ELSE m.created_at >= date_trunc(:part, now()) END)
    GROUP BY c.user_id
    """
)


async def usage_by_user(db: AsyncSession, part: str = "day") -> dict[int, int]:
    """一次聚合拿到**所有**用户在该窗口内的用量。

    管理员视角原先读的是 `user.daily/monthly/total_token_used` 三列 —— 全仓零写入，
    所以它对每个人都显示 0，而同一个数字在 `/api/current` 那边是现算的真值。
    这里是那份真值的批量版本：口径与 `period_usage()` 完全一致（同一段字符类与系数），
    区别只是别为每个用户各发一条查询。
    """
    result = await db.execute(_USAGE_BY_USER_SQL, {"cjk": _CJK_CLASS, "part": part})
    return {int(row[0]): int(row[1] or 0) for row in result.all()}


async def usage_snapshot(db: AsyncSession, user) -> dict:
    """给 /api/current 与成员详情用的用量快照。"""
    daily = await period_usage(db, user.id, "day")
    monthly = await period_usage(db, user.id, "month")
    return {
        "daily_token_used": daily,
        "daily_token_limit": user.daily_token_limit,
        "monthly_token_used": monthly,
        "monthly_token_limit": user.monthly_token_limit,
        # 界面靠这两个布尔决定画进度条还是画「无限制」。
        # 让前端各自判 limit<=0 会长出第二套口径。
        "daily_unlimited": is_unlimited(user.daily_token_limit),
        "monthly_unlimited": is_unlimited(user.monthly_token_limit),
    }


async def enforce_quota(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_relation_db),
):
    """请求路径上的配额闸门：超额直接 429，不进入推理。

    管理员豁免 —— 限流是为了防止某个人把本机算力占满，
    而管理员需要能在别人被限时仍然进得去做诊断。
    """
    if is_admin(current_user):
        return current_user

    if not is_unlimited(current_user.daily_token_limit):
        used = await period_usage(db, current_user.id, "day")
        if used >= current_user.daily_token_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"今日 token 用量已达上限（{used:,} / {current_user.daily_token_limit:,}）"
                    "，请等待次日重置，或联系管理员调整配额"
                ),
            )

    if not is_unlimited(current_user.monthly_token_limit):
        used = await period_usage(db, current_user.id, "month")
        if used >= current_user.monthly_token_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"本月 token 用量已达上限（{used:,} / {current_user.monthly_token_limit:,}）"
                    "，请联系管理员调整配额"
                ),
            )

    return current_user
