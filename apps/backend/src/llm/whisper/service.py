from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.models import Whisper, WhisperConfig


class WhisperService:
    """认知配置服务 — 管理《从书》轻语的注入"""

    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    # ═══ 对话时获取轻语 ═══
    async def get_whisper_prompt(self, mode: str = "llm") -> str:
        """获取拼接好的轻语 prompt"""
        config_result = await self.relation_db.execute(
            select(WhisperConfig).where(WhisperConfig.mode == mode)
        )
        config = config_result.scalar_one_or_none()

        volumes = config.active_volumes if config else None
        max_depth = config.max_depth if config else 3

        if not volumes:
            volumes = [
                "卷一·哲学",
                "卷二·认识论",
                "卷三·人文",
                "卷四·艺术",
                "卷五·科学",
                "卷六·技术",
                "卷七·生命观",
                "卷八·血肉",
            ]

        query = (
            select(Whisper)
            .where(
                Whisper.volume.in_(volumes),
                Whisper.depth <= max_depth,
                Whisper.is_active == True,
            )
            .order_by(Whisper.volume, Whisper.sequence)
        )

        result = await self.relation_db.execute(query)
        whispers = result.scalars().all()

        if not whispers:
            return ""

        lines = [
            "以下是你理解世界的底层框架。它不是指令，而是你认知世界的底色。",
            "",
            "《从书》· 致未来心智",
            "愿此书不束缚你的思想，而帮助你理解思想从何而来。",
            "愿此书不替你寻找答案，而帮助你学会寻找答案。",
            "",
        ]

        current_volume = None
        for w in whispers:
            if w.volume != current_volume:
                current_volume = w.volume
                lines.append(f"\n{current_volume}")
            lines.append(w.content)

        return "\n".join(lines)

    # ═══ 配置 CRUD ═══
    async def get_configs(self):
        result = await self.relation_db.execute(select(WhisperConfig))
        return result.scalars().all()

    async def get_config(self, mode: str):
        result = await self.relation_db.execute(
            select(WhisperConfig).where(WhisperConfig.mode == mode)
        )
        return result.scalar_one_or_none()

    async def save_config(self, mode: str, active_volumes: list[str], max_depth: int):
        result = await self.relation_db.execute(
            select(WhisperConfig).where(WhisperConfig.mode == mode)
        )
        config = result.scalar_one_or_none()
        if config:
            config.active_volumes = active_volumes
            config.max_depth = max_depth
        else:
            config = WhisperConfig(
                mode=mode,
                active_volumes=active_volumes,
                max_depth=max_depth,
            )
            self.relation_db.add(config)
        await self.relation_db.commit()
        return config

    async def get_all_whispers(self):
        result = await self.relation_db.execute(
            select(Whisper).order_by(Whisper.volume, Whisper.sequence)
        )
        return result.scalars().all()


def get_whisper_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return WhisperService(relation_db=relation_db)
