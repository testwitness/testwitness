def apply_percentage(total, percent):
    if not 0 <= percent <= 100:
        raise ValueError("percent out of range")
    return total * (100 - percent) / 100
